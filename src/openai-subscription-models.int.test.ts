import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PROVIDER_ERROR_CODES } from "./error-contract";
import { resolveAuthRoute } from "./model-factory";
import { writeOAuthTokens } from "./oauth-store";
import type { OAuthTokenSet } from "./oauth-store-contract";
import {
  fetchSubscriptionModels,
  resetSubscriptionModelsCache,
  subscriptionModels,
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

  test("the served set excludes code-mode and hidden models", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    const served = await subscriptionModels(fetchStub(), env);
    expect([...served]).toEqual(["gpt-5.5"]);
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

describe("subscriptionModels", () => {
  test("memoizes discovery so concurrent callers share one fetch", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    let codexCalls = 0;
    const fetchFn = fetchStub(() => (codexCalls += 1));
    const sets = await Promise.all([
      subscriptionModels(fetchFn, env),
      subscriptionModels(fetchFn, env),
      subscriptionModels(fetchFn, env),
    ]);
    expect(codexCalls).toBe(1);
    expect(sets.every((served) => served.has("gpt-5.5"))).toBe(true);
  });

  test("a discovery failure is a coded error, not an empty set that routes elsewhere", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    const failing: FetchFn = async (input) =>
      String(input).includes("api.github.com")
        ? new Response(JSON.stringify({ tag_name: "rust-v0.150.0" }))
        : new Response("", { status: 500 });

    await expect(subscriptionModels(failing, env)).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.subscriptionDiscoveryFailed,
    });
  });

  test("a transient discovery failure is not cached, so the next call retries", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    let codexAttempts = 0;
    const fetchFn: FetchFn = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "rust-v0.150.0" }));
      codexAttempts += 1;
      if (codexAttempts === 1) return new Response("", { status: 500 });
      return new Response(JSON.stringify(modelsResponse));
    };
    await expect(subscriptionModels(fetchFn, env)).rejects.toThrow();
    expect((await subscriptionModels(fetchFn, env)).has("gpt-5.5")).toBe(true);
    expect(codexAttempts).toBe(2);
  });
});

describe("resolveAuthRoute", () => {
  test("a served model routes to the subscription and an unserved one to the key", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    const stub = fetchStub();

    expect(await resolveAuthRoute("openai/gpt-5.5", { openai: { oauth: true } }, stub, env)).toBe("subscription");
    expect(await resolveAuthRoute("openai/gpt-5.6-luna", { openai: { oauth: true, apiKey: "sk" } }, stub, env)).toBe(
      "api_key",
    );
    expect(await resolveAuthRoute("openai/gpt-5.5", { openai: { apiKey: "sk" } }, stub, env)).toBe("api_key");
    expect(await resolveAuthRoute("anthropic/claude-sonnet-5", { openai: { oauth: true } }, stub, env)).toBe("api_key");
  });

  test("an unserved model with no key to fall back on fails by name", async () => {
    const env = { HOME: dirs.createDir("sm-") };
    await writeOAuthTokens("openai", fresh, env);
    await expect(
      resolveAuthRoute("openai/gpt-5.6-luna", { openai: { oauth: true } }, fetchStub(), env),
    ).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODES.modelNotOnSubscription,
    });
  });
});
