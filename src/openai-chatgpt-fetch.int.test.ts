import { afterEach, describe, expect, test } from "bun:test";
import { readOAuthTokensSync, writeOAuthTokens } from "./oauth-store";
import type { OAuthTokenSet } from "./oauth-store-contract";
import { withChatGPTAuthFetch } from "./openai-chatgpt-fetch";
import type { FetchFn } from "./rate-limiter";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

const fresh: OAuthTokenSet = {
  accessToken: "access-fresh",
  refreshToken: "refresh-1",
  expiresAt: Date.now() + 3_600_000,
  accountId: "acct_1",
};

const expired: OAuthTokenSet = { ...fresh, accessToken: "access-old", expiresAt: Date.now() - 1000 };

describe("withChatGPTAuthFetch", () => {
  test("injects bearer, account id, and originator without refreshing a fresh token", async () => {
    const env = { HOME: dirs.createDir("cf-") };
    await writeOAuthTokens("openai", fresh, env);
    let seen: Headers | undefined;
    const base: FetchFn = async (_input, init) => {
      seen = new Headers(init?.headers);
      return new Response("ok");
    };
    await withChatGPTAuthFetch(base, env)("https://chatgpt.com/backend-api/codex/responses", { method: "POST" });
    expect(seen?.get("authorization")).toBe("Bearer access-fresh");
    expect(seen?.get("chatgpt-account-id")).toBe("acct_1");
    expect(seen?.get("originator")).toBe("codex_cli_rs");
  });

  test("refreshes an expired token, persists it, and uses the new access token", async () => {
    const env = { HOME: dirs.createDir("cf-") };
    await writeOAuthTokens("openai", expired, env);
    let refreshCalls = 0;
    let authHeader: string | undefined;
    const base: FetchFn = async (input, init) => {
      if (String(input).endsWith("/oauth/token")) {
        refreshCalls += 1;
        return new Response(
          JSON.stringify({
            id_token: jwt({ chatgpt_account_id: "acct_1" }),
            access_token: "access-new",
            refresh_token: "refresh-2",
            expires_in: 3600,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      authHeader = new Headers(init?.headers).get("authorization") ?? undefined;
      return new Response("ok");
    };
    await withChatGPTAuthFetch(base, env)("https://chatgpt.com/backend-api/codex/responses");
    expect(refreshCalls).toBe(1);
    expect(authHeader).toBe("Bearer access-new");
    expect(readOAuthTokensSync("openai", env)?.accessToken).toBe("access-new");
    expect(readOAuthTokensSync("openai", env)?.refreshToken).toBe("refresh-2");
  });

  test("coalesces concurrent refreshes into a single token request", async () => {
    const env = { HOME: dirs.createDir("cf-") };
    await writeOAuthTokens("openai", expired, env);
    let refreshCalls = 0;
    const base: FetchFn = async (input) => {
      if (String(input).endsWith("/oauth/token")) {
        refreshCalls += 1;
        await Bun.sleep(20);
        return new Response(
          JSON.stringify({
            id_token: jwt({ chatgpt_account_id: "acct_1" }),
            access_token: "access-new",
            refresh_token: "refresh-2",
            expires_in: 3600,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("ok");
    };
    const fetchFn = withChatGPTAuthFetch(base, env);
    await Promise.all([fetchFn("https://x/responses"), fetchFn("https://x/responses"), fetchFn("https://x/responses")]);
    expect(refreshCalls).toBe(1);
  });

  test("on 401 re-reads a sibling-rotated token and retries once", async () => {
    const env = { HOME: dirs.createDir("cf-") };
    await writeOAuthTokens("openai", fresh, env);
    let calls = 0;
    const seenAuth: string[] = [];
    const base: FetchFn = async (_input, init) => {
      calls += 1;
      seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
      if (calls === 1) {
        // A sibling process rotates the stored token before the retry.
        await writeOAuthTokens("openai", { ...fresh, accessToken: "access-rotated" }, env);
        return new Response("unauthorized", { status: 401 });
      }
      return new Response("ok");
    };
    const res = await withChatGPTAuthFetch(base, env)("https://x/responses");
    expect(res.status).toBe(200);
    expect(seenAuth[0]).toBe("Bearer access-fresh");
    expect(seenAuth[1]).toBe("Bearer access-rotated");
  });

  test("throws a clear error when no subscription is connected", async () => {
    const env = { HOME: dirs.createDir("cf-") };
    const base: FetchFn = async () => new Response("ok");
    await expect(withChatGPTAuthFetch(base, env)("https://x/responses")).rejects.toThrow(/acolyte auth openai/);
  });
});
