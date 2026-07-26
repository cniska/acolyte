import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFakeProviderServer } from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { embedQuery } from "./memory-embedding";
import { pinEmbeddingProviders } from "./test-utils";

const openai = appConfig.openai as { baseUrl: string | undefined; apiKey: string | undefined };
let restoreProviders: () => void;

beforeAll(() => {
  restoreProviders = pinEmbeddingProviders({
    embeddingModel: "openai/text-embedding-3-large",
    openai: { apiKey: "fake-key" },
  });
});
afterAll(() => restoreProviders());

describe("embedQuery", () => {
  test("follows a base URL change without reusing the model built for the old one", async () => {
    const first = startFakeProviderServer();
    openai.baseUrl = first.baseUrl;
    expect(await embedQuery("a fact")).toHaveLength(64);
    first.stop();

    const second = startFakeProviderServer();
    openai.baseUrl = second.baseUrl;
    try {
      expect(await embedQuery("a fact")).toHaveLength(64);
    } finally {
      second.stop();
    }
  });

  test("uses the dedicated endpoint without changing chat provider routing", async () => {
    const endpoint = startFakeProviderServer();
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).endsWith("/embeddings")) requested.push(JSON.parse(String(init?.body)).model);
      return realFetch(url, init);
    }) as typeof fetch;

    const restore = pinEmbeddingProviders({
      embeddingModel: "nomic-embed-text",
      embeddingBaseUrl: endpoint.baseUrl,
      embeddingApiKey: "ollama",
    });
    try {
      expect(await embedQuery("a fact")).toHaveLength(64);
      expect(requested).toEqual(["nomic-embed-text"]);
    } finally {
      globalThis.fetch = realFetch;
      restore();
      endpoint.stop();
    }
  });
});
