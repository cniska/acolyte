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

export function formatModel(model: string): string {
  const slash = model.indexOf("/");
  return (slash >= 0 ? model.slice(slash + 1) : model).trim();
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
  }

  const prefix = trimmedModel.split("/", 1)[0]?.toLowerCase() ?? "";
  const parsed = providerSchema.safeParse(prefix);
  if (parsed.success) return parsed.data;
  const aliased = PROVIDER_PREFIX_ALIASES[prefix];
  if (aliased) return aliased;
  return "openai";
}

export function isProviderAvailable(input: {
  provider: Provider;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  googleApiKey?: string;
}): boolean {
  if (input.provider === "anthropic")
    return Boolean(input.anthropicApiKey) && isAnthropicBaseUrlValid(input.anthropicBaseUrl);
  if (input.provider === "google") return Boolean(input.googleApiKey);
  if (input.openaiBaseUrl && isOpenAICompatibleBaseUrl(input.openaiBaseUrl)) return true;
  return Boolean(input.openaiApiKey);
}
