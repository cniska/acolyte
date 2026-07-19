import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { authRouteForModel, usesOpenAiSubscription } from "./model-factory";
import { writeOAuthTokens } from "./oauth-store";
import type { OAuthTokenSet } from "./oauth-store-contract";
import {
  ensureSubscriptionModelsLoaded,
  fetchSubscriptionModels,
  isOpenAiSubscriptionModel,
  resetSubscriptionModelsCache,
} from "./openai-subscription-models";
import type { FetchFn } from "./rate-limiter";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(() => {
  dirs.cleanupDirs();
  resetSubscriptionModelsCache();
});
beforeEach(resetSubscriptionModelsCache);

const fresh: OAuthTokenSet = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: Date.now() + 3_600_000,
  accountId: "acct_1",
};

const modelsResponse = {
  models: [
    { slug: "gpt-5.5", visibility: "list", tool_mode: null },
    { slug: "gpt-5.6-luna", visibility: "list", tool_mode: "code_mode_only" },
    { slug: "gpt-5.4", visibility: "hide", tool_mode: null },
    { slug: "codex-auto-review", visibility: "hide", tool_mode: null },
  ],
};

function fetchStub(onCodex?: (url: string) => void): FetchFn {
  return async (input) => {
    const url = String(input);
    if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "rust-v0.150.0" }));
    onCodex?.(url);
    return new Response(JSON.stringify(modelsResponse));
  };
}

describe("fetchSubscriptionModels", () => {
  test("returns only listable non-code-mode slugs and pins the fetched client version", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    let codexUrl = "";
    const slugs = await fetchSubscriptionModels(
      fetchStub((u) => (codexUrl = u)),
      env,
    );
    expect(slugs).toEqual(["gpt-5.5"]);
    expect(codexUrl).toContain("client_version=0.150.0");
  });

  test("populates routing so membership excludes code-mode and hidden models", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    await fetchSubscriptionModels(fetchStub(), env);
    expect(isOpenAiSubscriptionModel("gpt-5.5")).toBe(true);
    expect(isOpenAiSubscriptionModel("gpt-5.6-luna")).toBe(false);
    expect(isOpenAiSubscriptionModel("gpt-5.4")).toBe(false);
    expect(isOpenAiSubscriptionModel("gpt-4o")).toBe(false);
  });

  test("routes a served model to the subscription only with oauth", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    await fetchSubscriptionModels(fetchStub(), env);
    expect(usesOpenAiSubscription("gpt-5.5", { oauth: true })).toBe(true);
    expect(usesOpenAiSubscription("gpt-5.6-luna", { oauth: true, apiKey: "sk" })).toBe(false);
    expect(usesOpenAiSubscription("gpt-5.5", { apiKey: "sk" })).toBe(false);
    expect(authRouteForModel("openai/gpt-5.5", { openai: { oauth: true } })).toBe("subscription");
    expect(authRouteForModel("openai/gpt-5.6-luna", { openai: { oauth: true, apiKey: "sk" } })).toBe("api_key");
  });

  test("uses the fallback version when the release lookup fails", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    let codexUrl = "";
    const fetchFn: FetchFn = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) return new Response("", { status: 500 });
      codexUrl = url;
      return new Response(JSON.stringify(modelsResponse));
    };
    await fetchSubscriptionModels(fetchFn, env);
    expect(codexUrl).toContain("client_version=0.144.6");
  });
});

describe("ensureSubscriptionModelsLoaded", () => {
  test("memoizes discovery so concurrent callers share one fetch", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    let codexCalls = 0;
    const fetchFn = fetchStub(() => (codexCalls += 1));
    await Promise.all([
      ensureSubscriptionModelsLoaded(fetchFn, env),
      ensureSubscriptionModelsLoaded(fetchFn, env),
      ensureSubscriptionModelsLoaded(fetchFn, env),
    ]);
    expect(codexCalls).toBe(1);
    expect(isOpenAiSubscriptionModel("gpt-5.5")).toBe(true);
  });
});
