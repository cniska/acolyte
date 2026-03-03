import type { ModelProvider } from "./provider-contract";

export type ModelProviderName = ModelProvider;
export type ProviderName = ModelProviderName;
type SupportedProviderName = Exclude<ModelProviderName, "openai-compatible">;

const SUGGESTED_MODELS: Record<SupportedProviderName, string[]> = {
  openai: ["gpt-5-mini", "gpt-5", "gpt-5-nano"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  "gpt-5-mini": "balanced default",
  "gpt-5": "highest quality",
  "gpt-5-nano": "fastest and lowest cost",
  "claude-sonnet-4-5": "balanced default",
  "claude-opus-4-1": "highest quality",
  "claude-haiku-4-5": "fastest and lowest cost",
  "gemini-2.5-flash": "fast and efficient",
  "gemini-2.5-pro": "highest quality",
  "gemini-2.0-flash": "low-latency default",
};

function inferUnqualifiedModelPrefix(model: string): "openai" | "anthropic" | "gemini" {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("claude")) return "anthropic";
  if (normalized.startsWith("gemini")) return "gemini";
  return "openai";
}

export function normalizeModel(model: string): string {
  if (model.includes("/")) return model;
  const prefix = inferUnqualifiedModelPrefix(model);
  return `${prefix}/${model}`;
}

export function formatModel(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export function resolveProvider(_openaiApiKey: string | undefined, openaiBaseUrl: string): ProviderName {
  try {
    const host = new URL(openaiBaseUrl).hostname.toLowerCase();
    if (host === "api.openai.com") return "openai";
    return "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}

export function providerFromModel(model: string): ModelProviderName {
  const trimmedModel = model.trim();
  const normalizedModel = trimmedModel.toLowerCase();
  if (!normalizedModel.includes("/")) {
    if (normalizedModel.startsWith("claude")) return "anthropic";
    if (normalizedModel.startsWith("gemini")) return "gemini";
  }

  const prefix = trimmedModel.split("/", 1)[0]?.toLowerCase();
  if (prefix === "anthropic") return "anthropic";
  if (prefix === "gemini" || prefix === "google") return "gemini";
  if (prefix === "openai-compatible") return "openai-compatible";
  return "openai";
}

export function isProviderAvailable(input: {
  provider: ModelProviderName;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}): boolean {
  if (input.provider === "anthropic") return Boolean(input.anthropicApiKey);
  if (input.provider === "gemini") return Boolean(input.googleApiKey);
  if (input.provider === "openai-compatible") return true;
  return resolveProvider(input.openaiApiKey, input.openaiBaseUrl) === "openai-compatible"
    ? true
    : Boolean(input.openaiApiKey);
}

export function suggestedModelsForProvider(provider: ModelProviderName): string[] {
  if (provider === "openai-compatible") return SUGGESTED_MODELS.openai;
  return SUGGESTED_MODELS[provider];
}

export function describeModel(model: string): string {
  return MODEL_DESCRIPTIONS[model] ?? "supported model";
}
