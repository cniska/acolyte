import { appConfig } from "./app-config";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";
import { normalizeBaseUrl } from "./url-utils";

type ProviderFetchConfig = {
  apiKey?: string;
  baseUrl?: string;
};

const CACHE_TTL_MS = 60_000;

let modelsCache: {
  models: string[];
  fetchedAt: number;
} | null = null;

export function invalidateModelsCache(): void {
  modelsCache = null;
}

async function fetchOpenAIModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? "https://api.openai.com/v1");
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
}

async function fetchAnthropicModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? "https://api.anthropic.com/v1");
  const res = await fetch(`${baseUrl}/models`, {
    headers: {
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
}

async function fetchGoogleModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? "https://generativelanguage.googleapis.com");
  const res = await fetch(`${baseUrl}/v1beta/models?key=${config.apiKey}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { models?: Array<{ name: string }> };
  return (json.models ?? []).map((m) => m.name.replace(/^models\//, ""));
}

async function fetchProviderModels(provider: Provider, config: ProviderFetchConfig): Promise<string[]> {
  try {
    switch (provider) {
      case "openai":
        return await fetchOpenAIModels(config);
      case "anthropic":
        return await fetchAnthropicModels(config);
      case "google":
        return await fetchGoogleModels(config);
    }
  } catch {
    return [];
  }
}

function providerConfig(provider: Provider): ProviderFetchConfig {
  switch (provider) {
    case "openai":
      return { apiKey: appConfig.openai.apiKey, baseUrl: appConfig.openai.baseUrl };
    case "anthropic":
      return { apiKey: appConfig.anthropic.apiKey, baseUrl: appConfig.anthropic.baseUrl };
    case "google":
      return { apiKey: appConfig.google.apiKey, baseUrl: appConfig.google.baseUrl };
  }
}

function availableProviders(currentModel: string): Provider[] {
  const providers: Provider[] = [];
  if (
    isProviderAvailable({
      provider: "openai",
      openaiApiKey: appConfig.openai.apiKey,
      openaiBaseUrl: appConfig.openai.baseUrl,
    })
  )
    providers.push("openai");
  if (
    isProviderAvailable({
      provider: "anthropic",
      anthropicApiKey: appConfig.anthropic.apiKey,
      openaiBaseUrl: appConfig.openai.baseUrl,
      anthropicBaseUrl: appConfig.anthropic.baseUrl,
    })
  )
    providers.push("anthropic");
  if (
    isProviderAvailable({
      provider: "google",
      googleApiKey: appConfig.google.apiKey,
      openaiBaseUrl: appConfig.openai.baseUrl,
    })
  )
    providers.push("google");
  const fallback = providerFromModel(currentModel);
  if (!providers.includes(fallback)) providers.push(fallback);
  return providers;
}

export async function getAvailableModels(currentModel: string): Promise<string[]> {
  const now = Date.now();
  if (modelsCache && now - modelsCache.fetchedAt < CACHE_TTL_MS) return modelsCache.models;

  const providers = availableProviders(currentModel);
  const results = await Promise.all(providers.map((p) => fetchProviderModels(p, providerConfig(p))));
  const seen = new Set<string>();
  const models: string[] = [];
  for (const list of results) {
    for (const id of list) {
      if (!seen.has(id)) {
        seen.add(id);
        models.push(id);
      }
    }
  }
  models.sort((a, b) => a.localeCompare(b));
  modelsCache = { models, fetchedAt: now };
  return models;
}
