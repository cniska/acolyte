import { createHash } from "node:crypto";
import type { LanguageModelV3FunctionTool, LanguageModelV3Message, SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { Provider } from "./provider-contract";

const CACHE_CONTROL = { type: "ephemeral" as const };

export function createPromptCacheKey(input: { model: string; sessionId?: string; workspace?: string }): string {
  const source = [input.model, input.sessionId ?? "", input.workspace ?? ""].join("\n");
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 32);
  return `acolyte-${digest}`;
}

export function mergeProviderOptions(
  first: SharedV3ProviderOptions | undefined,
  second: SharedV3ProviderOptions | undefined,
): SharedV3ProviderOptions | undefined {
  if (!first) return second;
  if (!second) return first;
  const merged: SharedV3ProviderOptions = { ...first };
  for (const [provider, options] of Object.entries(second)) {
    merged[provider] = { ...(merged[provider] ?? {}), ...options };
  }
  return merged;
}

export function promptCacheProviderOptions(provider: Provider, cacheKey: string): SharedV3ProviderOptions | undefined {
  switch (provider) {
    case "openai":
      return { openai: { promptCacheKey: cacheKey } };
    case "vercel":
      return {
        gateway: { caching: "auto" },
        openai: { promptCacheKey: cacheKey },
      };
    case "anthropic":
    case "google":
      return undefined;
  }
}

export function applyPromptCacheMarkers(
  provider: Provider,
  messages: LanguageModelV3Message[],
  tools: LanguageModelV3FunctionTool[],
): void {
  if (provider !== "anthropic") return;

  const system = messages.find((message) => message.role === "system");
  if (system) {
    system.providerOptions = mergeProviderOptions(system.providerOptions, {
      anthropic: { cacheControl: CACHE_CONTROL },
    });
  }

  const lastTool = tools.at(-1);
  if (lastTool) {
    lastTool.providerOptions = mergeProviderOptions(lastTool.providerOptions, {
      anthropic: { cacheControl: CACHE_CONTROL },
    });
  }
}

export function withVercelPromptCacheFetch(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  return (async (input, init) => {
    const body = init?.body;
    if (typeof body !== "string") return fetchFn(input, init);

    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fetchFn(input, init);
      const record = parsed as Record<string, unknown>;
      const providerOptions =
        record.providerOptions && typeof record.providerOptions === "object" && !Array.isArray(record.providerOptions)
          ? (record.providerOptions as Record<string, unknown>)
          : {};
      const gateway =
        providerOptions.gateway &&
        typeof providerOptions.gateway === "object" &&
        !Array.isArray(providerOptions.gateway)
          ? (providerOptions.gateway as Record<string, unknown>)
          : {};
      record.providerOptions = {
        ...providerOptions,
        gateway: {
          ...gateway,
          caching: gateway.caching ?? "auto",
        },
      };
      return fetchFn(input, { ...init, body: JSON.stringify(record) });
    } catch {
      return fetchFn(input, init);
    }
  }) as typeof globalThis.fetch;
}
