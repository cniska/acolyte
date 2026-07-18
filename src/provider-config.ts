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

// Unknown prefixes fall back to Vercel: its AI Gateway is the multi-provider entry point that
// fronts many upstream models behind one OpenAI-compatible API.
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

export function isProviderAvailable(provider: Provider, credentials: ProviderCredentials): boolean {
  if (provider === "anthropic") return Boolean(credentials.apiKey) && isAnthropicBaseUrlValid(credentials.baseUrl);
  if (provider === "google") return Boolean(credentials.apiKey);
  if (provider === "vercel") return Boolean(credentials.apiKey);
  if (credentials.baseUrl && isOpenAICompatibleBaseUrl(credentials.baseUrl)) return true;
  return Boolean(credentials.apiKey);
}
