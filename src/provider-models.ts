import { appConfig } from "./app-config";
import { isProviderAvailable } from "./provider-config";
import type { Provider } from "./provider-contract";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

type ProviderFetchConfig = {
  apiKey?: string;
  baseUrl: string;
};

const CACHE_TTL_MS = 60_000;

let modelsCache: {
  models: string[];
  fetchedAt: number;
} | null = null;

let inflight: Promise<string[]> | null = null;

export function invalidateModelsCache(): void {
  modelsCache = null;
}

async function fetchOpenAIModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
}

async function fetchAnthropicModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
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
  const baseUrl = normalizeBaseUrl(config.baseUrl);
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

function availableProviders(): Provider[] {
  const providers: Provider[] = [];
  if (isProviderAvailable("openai", appConfig.openai)) providers.push("openai");
  if (isProviderAvailable("anthropic", appConfig.anthropic)) providers.push("anthropic");
  if (isProviderAvailable("google", appConfig.google)) providers.push("google");
  return providers;
}

export async function getAvailableModels(): Promise<string[]> {
  const now = Date.now();
  if (modelsCache && now - modelsCache.fetchedAt < CACHE_TTL_MS) return modelsCache.models;

  if (inflight) return inflight;

  inflight = (async () => {
    const providers = availableProviders();
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
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
