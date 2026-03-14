import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { appConfig } from "./app-config";
import { getAvailableModels, invalidateModelsCache } from "./provider-models";

let savedApiKey: string | undefined;
let savedBaseUrl: string | undefined;
let savedAnthropicApiKey: string | undefined;
let savedGoogleApiKey: string | undefined;

beforeEach(() => {
  savedApiKey = appConfig.openai.apiKey;
  savedBaseUrl = appConfig.openai.baseUrl;
  savedAnthropicApiKey = appConfig.anthropic.apiKey;
  savedGoogleApiKey = appConfig.google.apiKey;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "test-key";
  (appConfig.anthropic as { apiKey: string | undefined }).apiKey = undefined;
  (appConfig.google as { apiKey: string | undefined }).apiKey = undefined;
});

afterEach(() => {
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
  (appConfig.openai as { baseUrl: string | undefined }).baseUrl = savedBaseUrl;
  (appConfig.anthropic as { apiKey: string | undefined }).apiKey = savedAnthropicApiKey;
  (appConfig.google as { apiKey: string | undefined }).apiKey = savedGoogleApiKey;
  invalidateModelsCache();
  mock.restore();
});

describe("getAvailableModels", () => {
  test("returns sorted deduped models from fetch responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("/v1/models") && !urlStr.includes("v1beta")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "gpt-5.2" }] }), { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels();
      expect(models).toContain("gpt-5-mini");
      expect(models).toContain("gpt-5.2");
      expect(models).toEqual([...models].sort());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns cached results within TTL", async () => {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      fetchCount++;
      return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await getAvailableModels();
      const first = fetchCount;
      await getAvailableModels();
      expect(fetchCount).toBe(first);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns empty array on fetch failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels();
      expect(models).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("prefixes models from local OpenAI-compatible endpoints", async () => {
    (appConfig.openai as { apiKey: string | undefined }).apiKey = undefined;
    (appConfig.openai as { baseUrl: string }).baseUrl = "http://localhost:11434/v1";
    let authHeader: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder:3b" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels();
      expect(models).toEqual(["openai-compatible/qwen2.5-coder:3b"]);
      expect(authHeader).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends configured api key for openai-compatible model discovery", async () => {
    (appConfig.openai as { apiKey: string | undefined }).apiKey = "test-key";
    (appConfig.openai as { baseUrl: string }).baseUrl = "http://localhost:11434/v1";
    let authHeader: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder:3b" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await getAvailableModels();
      expect(authHeader ?? "").toBe("Bearer test-key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
