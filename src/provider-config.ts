import type { Provider } from "./provider-contract";

type ModelMeta = {
  id: string;
  description: string;
};

const MODEL_REGISTRY: Record<Provider, ModelMeta[]> = {
  openai: [
    { id: "gpt-5.2", description: "highest quality" },
    { id: "gpt-5-mini", description: "balanced default" },
    { id: "gpt-5-nano", description: "fastest and lowest cost" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", description: "highest quality" },
    { id: "claude-sonnet-4-6", description: "balanced default" },
    { id: "claude-haiku-4-5", description: "fastest and lowest cost" },
  ],
  gemini: [
    { id: "gemini-2.5-flash-preview-05-20", description: "fast and efficient" },
    { id: "gemini-2.5-pro-preview-05-06", description: "highest quality" },
    { id: "gemini-2.0-flash", description: "low-latency default" },
  ],
};

const MODEL_DESCRIPTION_BY_ID: Record<string, string> = Object.fromEntries(
  Object.values(MODEL_REGISTRY).flatMap((models) => models.map((model) => [model.id, model.description])),
);

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

function isOpenAICompatibleBaseUrl(openaiBaseUrl: string): boolean {
  try {
    const host = new URL(openaiBaseUrl).hostname.toLowerCase();
    return host !== "api.openai.com";
  } catch {
    return true;
  }
}

export function providerFromModel(model: string): Provider {
  const trimmedModel = model.trim();
  const normalizedModel = trimmedModel.toLowerCase();
  if (!normalizedModel.includes("/")) {
    if (normalizedModel.startsWith("claude")) return "anthropic";
    if (normalizedModel.startsWith("gemini")) return "gemini";
  }

  const prefix = trimmedModel.split("/", 1)[0]?.toLowerCase();
  if (prefix === "anthropic") return "anthropic";
  if (prefix === "gemini" || prefix === "google") return "gemini";
  if (prefix === "openai-compatible") return "openai";
  return "openai";
}

export function isProviderAvailable(input: {
  provider: Provider;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}): boolean {
  if (input.provider === "anthropic") return Boolean(input.anthropicApiKey);
  if (input.provider === "gemini") return Boolean(input.googleApiKey);
  if (isOpenAICompatibleBaseUrl(input.openaiBaseUrl)) return true;
  return Boolean(input.openaiApiKey);
}

export function suggestedModelsForProvider(provider: Provider): string[] {
  return MODEL_REGISTRY[provider].map((model) => model.id);
}

export function describeModel(model: string): string {
  return MODEL_DESCRIPTION_BY_ID[model] ?? "supported model";
}
