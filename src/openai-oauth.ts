import type { OAuthTokenSet } from "./oauth-store-contract";
import {
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_ISSUER,
  OPENAI_OAUTH_ORIGINATOR,
  OPENAI_OAUTH_REDIRECT_URI,
  OPENAI_OAUTH_SCOPE,
  oauthJwtClaimsSchema,
  oauthTokenResponseSchema,
} from "./openai-oauth-contract";
import type { FetchFn } from "./rate-limiter";

export type PkceCodes = { verifier: string; challenge: string };

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function createPkce(): PkceCodes {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(verifier);
  const challenge = hasher.digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(input: { challenge: string; state: string }): string {
  const url = new URL(`${OPENAI_OAUTH_ISSUER}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", OPENAI_OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_OAUTH_SCOPE);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("state", input.state);
  url.searchParams.set("originator", OPENAI_OAUTH_ORIGINATOR);
  return url.toString();
}

function decodeJwtClaims(token: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function accountIdFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const parsed = oauthJwtClaimsSchema.safeParse(decodeJwtClaims(token));
  if (!parsed.success) return undefined;
  const claims = parsed.data;
  return (
    claims.chatgpt_account_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.organizations?.[0]?.id
  );
}

export function extractAccountId(idToken: string | undefined, accessToken: string | undefined): string | undefined {
  return accountIdFromToken(idToken) ?? accountIdFromToken(accessToken);
}

async function postToken(body: URLSearchParams, fetchFn: FetchFn): Promise<OAuthTokenSet> {
  const response = await fetchFn(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`OpenAI token request failed: ${response.status}`);
  }
  const tokens = oauthTokenResponseSchema.parse(await response.json());
  const accountId = extractAccountId(tokens.id_token, tokens.access_token);
  if (!accountId) throw new Error("OpenAI token response is missing a ChatGPT account id");
  if (!tokens.refresh_token) throw new Error("OpenAI token response is missing a refresh token");
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    accountId,
  };
}

export function exchangeCode(input: { code: string; verifier: string }, fetchFn: FetchFn): Promise<OAuthTokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
      client_id: OPENAI_OAUTH_CLIENT_ID,
      code_verifier: input.verifier,
    }),
    fetchFn,
  );
}

export async function refreshOAuthTokens(current: OAuthTokenSet, fetchFn: FetchFn): Promise<OAuthTokenSet> {
  const response = await fetchFn(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`OpenAI token refresh failed: ${response.status}`);
  }
  const tokens = oauthTokenResponseSchema.parse(await response.json());
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    accountId: extractAccountId(tokens.id_token, tokens.access_token) ?? current.accountId,
  };
}
