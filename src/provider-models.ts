import { defaultCredentials, type ProviderCredentialsMap } from "./agent-model";
import { unreachable } from "./assert";
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
  credentialsKey: string;
} | null = null;

let inflight: Promise<string[]> | null = null;

export function invalidateModelsCache(): void {
  modelsCache = null;
}

function credentialsCacheKey(credentials: ProviderCredentialsMap): string {
  return [
    credentials.openai?.apiKey ?? "",
    credentials.anthropic?.apiKey ?? "",
    credentials.google?.apiKey ?? "",
    credentials.vercel?.apiKey ?? "",
  ].join("\0");
}

async function fetchOpenAIModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${baseUrl}/models`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
}

function isOpenAIHostedBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

function normalizeDiscoveredModel(provider: Provider, id: string, config: ProviderFetchConfig): string {
  if (provider === "openai" && !isOpenAIHostedBaseUrl(config.baseUrl)) return `openai-compatible/${id}`;
  return id;
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

async function fetchVercelModels(config: ProviderFetchConfig): Promise<string[]> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${baseUrl}/models`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id);
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
      case "vercel":
        return await fetchVercelModels(config);
      default:
        return unreachable(provider);
    }
  } catch {
    return [];
  }
}

function providerConfig(provider: Provider, credentials: ProviderCredentialsMap): ProviderFetchConfig {
  switch (provider) {
    case "openai":
    case "anthropic":
    case "google":
    case "vercel": {
      const creds = credentials[provider] ?? {};
      return { apiKey: creds.apiKey, baseUrl: creds.baseUrl ?? "" };
    }
    default:
      return unreachable(provider);
  }
}

function availableProviders(credentials: ProviderCredentialsMap): Provider[] {
  const providers: Provider[] = [];
  if (isProviderAvailable("openai", credentials.openai ?? {})) providers.push("openai");
  if (isProviderAvailable("anthropic", credentials.anthropic ?? {})) providers.push("anthropic");
  if (isProviderAvailable("google", credentials.google ?? {})) providers.push("google");
  if (isProviderAvailable("vercel", credentials.vercel ?? {})) providers.push("vercel");
  return providers;
}

export async function getAvailableModels(credentials?: ProviderCredentialsMap): Promise<string[]> {
  const now = Date.now();
  const creds = credentials ?? defaultCredentials();
  const key = credentialsCacheKey(creds);
  if (modelsCache && now - modelsCache.fetchedAt < CACHE_TTL_MS && modelsCache.credentialsKey === key)
    return modelsCache.models;

  if (inflight) return inflight;
  inflight = (async () => {
    const providers = availableProviders(creds);
    const results = await Promise.all(
      providers.map(async (provider) => {
        const config = providerConfig(provider, creds);
        const models = await fetchProviderModels(provider, config);
        return models.map((id) => normalizeDiscoveredModel(provider, id, config));
      }),
    );
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
    modelsCache = { models, fetchedAt: now, credentialsKey: key };
    return models;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
