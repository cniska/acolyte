import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getAvailableModels, invalidateModelsCache } from "./provider-models";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com";

beforeEach(() => {
  invalidateModelsCache();
});

afterEach(() => {
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
      const models = await getAvailableModels({ openai: { apiKey: "test-key", baseUrl: OPENAI_BASE_URL } });
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
      const creds = { openai: { apiKey: "test-key", baseUrl: OPENAI_BASE_URL } };
      await getAvailableModels(creds);
      const first = fetchCount;
      await getAvailableModels(creds);
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
      const models = await getAvailableModels({ openai: { apiKey: "test-key", baseUrl: OPENAI_BASE_URL } });
      expect(models).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("prefixes models from local OpenAI-compatible endpoints", async () => {
    let authHeader: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder:3b" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels({ openai: { baseUrl: "http://localhost:11434/v1" } });
      expect(models).toEqual(["openai-compatible/qwen2.5-coder:3b"]);
      expect(authHeader).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends configured api key for openai-compatible model discovery", async () => {
    let authHeader: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder:3b" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await getAvailableModels({ openai: { apiKey: "test-key", baseUrl: "http://localhost:11434/v1" } });
      expect(authHeader ?? "").toBe("Bearer test-key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches anthropic models with correct headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(
        JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5-20251001" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels({ anthropic: { apiKey: "sk-ant-test", baseUrl: ANTHROPIC_BASE_URL } });
      expect(models).toContain("claude-sonnet-4-6");
      expect(models).toContain("claude-haiku-4-5-20251001");
      expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test");
      expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches google models with api key as query param and strips models/ prefix", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      return new Response(
        JSON.stringify({ models: [{ name: "models/gemini-2.5-pro" }, { name: "models/gemini-2.0-flash" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels({ google: { apiKey: "goog-test-key", baseUrl: GOOGLE_BASE_URL } });
      expect(models).toContain("gemini-2.5-pro");
      expect(models).toContain("gemini-2.0-flash");
      expect(capturedUrl).toContain("key=goog-test-key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deduplicates models across providers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({ data: [{ id: "shared-model" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ id: "shared-model" }, { id: "gpt-5-mini" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const models = await getAvailableModels({
        openai: { apiKey: "test-key", baseUrl: OPENAI_BASE_URL },
        anthropic: { apiKey: "sk-ant-test", baseUrl: ANTHROPIC_BASE_URL },
      });
      const sharedCount = models.filter((m) => m === "shared-model").length;
      expect(sharedCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
