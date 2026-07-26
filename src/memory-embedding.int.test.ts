import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFakeProviderServer } from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { embedQuery } from "./memory-embedding";

const config = appConfig as { embeddingModel: string };
const openai = appConfig.openai as { baseUrl: string; apiKey: string | undefined };
let savedModel: string;
let savedBaseUrl: string;
let savedApiKey: string | undefined;

beforeAll(() => {
  savedModel = config.embeddingModel;
  savedBaseUrl = openai.baseUrl;
  savedApiKey = openai.apiKey;
  config.embeddingModel = "text-embedding-3-large";
  openai.apiKey = "fake-key";
});
afterAll(() => {
  config.embeddingModel = savedModel;
  openai.baseUrl = savedBaseUrl;
  openai.apiKey = savedApiKey;
});

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
});
