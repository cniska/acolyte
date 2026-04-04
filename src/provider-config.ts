import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ReasoningLevel } from "./config-contract";
import { type Provider, providerSchema } from "./provider-contract";

const MODEL_NAME_PREFIX_TO_PROVIDER: Record<string, Provider> = {
  claude: "anthropic",
  gemini: "google",
};

const PROVIDER_PREFIX_ALIASES: Record<string, Provider> = {
  "openai-compatible": "openai",
};

function inferUnqualifiedModelPrefix(model: string): Provider {
  const normalized = model.trim().toLowerCase();
  for (const [namePrefix, provider] of Object.entries(MODEL_NAME_PREFIX_TO_PROVIDER)) {
    if (normalized.startsWith(namePrefix)) return provider;
  }
  return "openai";
}

export function normalizeModel(model: string): string {
  if (model.includes("/")) return model;
  const prefix = inferUnqualifiedModelPrefix(model);
  return `${prefix}/${model}`;
}

export function formatModel(model: string, reasoning?: ReasoningLevel): string {
  const name = (model.indexOf("/") >= 0 ? model.slice(model.indexOf("/") + 1) : model).trim();
  if (reasoning && reasoning !== DEFAULT_REASONING) return `${name} (${reasoning})`;
  return name;
}

function isOpenAICompatibleBaseUrl(openaiBaseUrl: string): boolean {
  try {
    const host = new URL(openaiBaseUrl).hostname.toLowerCase();
    return host !== "api.openai.com";
  } catch {
    return true;
  }
}

function isAnthropicBaseUrlValid(anthropicBaseUrl?: string): boolean {
  if (!anthropicBaseUrl) return true;
  try {
    const parsed = new URL(anthropicBaseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return normalizedPath.endsWith("/v1");
  } catch {
    return false;
  }
}

export function providerFromModel(model: string): Provider {
  const trimmedModel = model.trim();
  const normalizedModel = trimmedModel.toLowerCase();
  if (!normalizedModel.includes("/")) {
    for (const [namePrefix, provider] of Object.entries(MODEL_NAME_PREFIX_TO_PROVIDER)) {
      if (normalizedModel.startsWith(namePrefix)) return provider;
    }
    return "openai";
  }

  const prefix = trimmedModel.split("/", 1)[0]?.toLowerCase() ?? "";
  const parsed = providerSchema.safeParse(prefix);
  if (parsed.success) return parsed.data;
  const aliased = PROVIDER_PREFIX_ALIASES[prefix];
  if (aliased) return aliased;
  return "vercel";
}

export type ProviderCredentials = { apiKey?: string; baseUrl?: string };

export const DEFAULT_REASONING = "medium";

const ANTHROPIC_THINKING_BUDGET: Record<string, number> = {
  low: 5_000,
  medium: 10_000,
  high: 20_000,
};

export function reasoningProviderOptions(
  provider: Provider,
  level: ReasoningLevel | undefined,
): SharedV3ProviderOptions | undefined {
  if (!level) return undefined;
  switch (provider) {
    case "openai":
    case "vercel":
      return { openai: { reasoningEffort: level } };
    case "anthropic":
      return { anthropic: { thinking: { type: "enabled", budgetTokens: ANTHROPIC_THINKING_BUDGET[level] ?? 10_000 } } };
    case "google":
      return { google: { thinkingConfig: { thinkingLevel: level } } };
  }
}

export function isProviderAvailable(provider: Provider, credentials: ProviderCredentials): boolean {
  if (provider === "anthropic") return Boolean(credentials.apiKey) && isAnthropicBaseUrlValid(credentials.baseUrl);
  if (provider === "google") return Boolean(credentials.apiKey);
  if (provider === "vercel") return Boolean(credentials.apiKey);
  if (credentials.baseUrl && isOpenAICompatibleBaseUrl(credentials.baseUrl)) return true;
  return Boolean(credentials.apiKey);
}
