import { afterEach, describe, expect, mock, test } from "bun:test";
import { getAvailableModels, invalidateModelsCache } from "./provider-models";

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
      const models = await getAvailableModels("gpt-5-mini");
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
      await getAvailableModels("model-a");
      const first = fetchCount;
      await getAvailableModels("model-a");
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
      const models = await getAvailableModels("gpt-5-mini");
      expect(models).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
