import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl, createPkce, exchangeCode, extractAccountId, refreshOAuthTokens } from "./openai-oauth";
import { OPENAI_OAUTH_CLIENT_ID, OPENAI_OAUTH_REDIRECT_URI } from "./openai-oauth-contract";
import type { FetchFn } from "./rate-limiter";

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const accountJwt = jwt({ chatgpt_account_id: "acct_top" });

describe("createPkce", () => {
  test("verifier uses only base64url-safe characters and is long enough", () => {
    const { verifier } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  test("challenge is the base64url sha256 of the verifier", () => {
    const { verifier, challenge } = createPkce();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(verifier);
    expect(challenge).toBe(hasher.digest("base64url"));
  });
});

describe("buildAuthorizeUrl", () => {
  test("sets the required PKCE and codex flow params", () => {
    const url = new URL(buildAuthorizeUrl({ challenge: "chal", state: "st" }));
    const p = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe("https://auth.openai.com/oauth/authorize");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(OPENAI_OAUTH_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(OPENAI_OAUTH_REDIRECT_URI);
    expect(p.get("scope")).toBe("openid profile email offline_access");
    expect(p.get("code_challenge")).toBe("chal");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("id_token_add_organizations")).toBe("true");
    expect(p.get("codex_cli_simplified_flow")).toBe("true");
    expect(p.get("state")).toBe("st");
  });
});

describe("extractAccountId", () => {
  test("prefers top-level chatgpt_account_id", () => {
    expect(extractAccountId(jwt({ chatgpt_account_id: "top" }), undefined)).toBe("top");
  });

  test("falls back to the namespaced auth claim", () => {
    expect(extractAccountId(jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "ns" } }), undefined)).toBe(
      "ns",
    );
  });

  test("falls back to the first organization id", () => {
    expect(extractAccountId(jwt({ organizations: [{ id: "org_1" }] }), undefined)).toBe("org_1");
  });

  test("falls back from id_token to access_token", () => {
    expect(extractAccountId(jwt({ foo: "bar" }), jwt({ chatgpt_account_id: "from_access" }))).toBe("from_access");
  });

  test("returns undefined for malformed tokens", () => {
    expect(extractAccountId("not-a-jwt", undefined)).toBeUndefined();
    expect(extractAccountId(undefined, undefined)).toBeUndefined();
  });
});

describe("exchangeCode", () => {
  test("posts the authorization-code grant and returns a token set", async () => {
    let captured: { url: string; body: string } | undefined;
    const fetchFn: FetchFn = async (input, init) => {
      captured = { url: String(input), body: String(init?.body) };
      return jsonResponse({
        id_token: accountJwt,
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
      });
    };
    const before = Date.now();
    const tokens = await exchangeCode({ code: "the-code", verifier: "the-verifier" }, fetchFn);
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.accountId).toBe("acct_top");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);

    expect(captured?.url).toBe("https://auth.openai.com/oauth/token");
    const body = new URLSearchParams(captured?.body ?? "");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("client_id")).toBe(OPENAI_OAUTH_CLIENT_ID);
  });

  test("throws when the account id cannot be extracted", async () => {
    const fetchFn: FetchFn = async () =>
      jsonResponse({ id_token: jwt({ foo: 1 }), access_token: "a", refresh_token: "r", expires_in: 3600 });
    await expect(exchangeCode({ code: "c", verifier: "v" }, fetchFn)).rejects.toThrow(/account id/);
  });

  test("throws when the refresh token is missing", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ id_token: accountJwt, access_token: "a", expires_in: 3600 });
    await expect(exchangeCode({ code: "c", verifier: "v" }, fetchFn)).rejects.toThrow(/refresh token/);
  });

  test("throws on a non-ok response", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ error: "bad" }, 400);
    await expect(exchangeCode({ code: "c", verifier: "v" }, fetchFn)).rejects.toThrow(/400/);
  });
});

describe("refreshOAuthTokens", () => {
  const current = { accessToken: "old", refreshToken: "old-refresh", expiresAt: 0, accountId: "acct_old" };

  test("keeps the old refresh token and account id when the response omits them", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ id_token: "", access_token: "new", expires_in: 3600 });
    const tokens = await refreshOAuthTokens(current, fetchFn);
    expect(tokens.accessToken).toBe("new");
    expect(tokens.refreshToken).toBe("old-refresh");
    expect(tokens.accountId).toBe("acct_old");
  });

  test("adopts a rotated refresh token and new account id", async () => {
    const fetchFn: FetchFn = async () =>
      jsonResponse({
        id_token: jwt({ chatgpt_account_id: "acct_new" }),
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 3600,
      });
    const tokens = await refreshOAuthTokens(current, fetchFn);
    expect(tokens.refreshToken).toBe("rotated");
    expect(tokens.accountId).toBe("acct_new");
  });

  test("throws on a non-ok response", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ error: "nope" }, 401);
    await expect(refreshOAuthTokens(current, fetchFn)).rejects.toThrow(/401/);
  });
});
