import { readOAuthTokensSync, writeOAuthTokens } from "./oauth-store";
import type { OAuthTokenSet } from "./oauth-store-contract";
import { refreshOAuthTokens } from "./openai-oauth";
import { OPENAI_OAUTH_ORIGINATOR } from "./openai-oauth-contract";
import type { Env } from "./paths";
import type { FetchFn } from "./rate-limiter";

const EXPIRY_SKEW_MS = 60_000;

let inflightRefresh: Promise<OAuthTokenSet> | undefined;

async function ensureFreshTokens(fetchFn: FetchFn, env?: Env): Promise<OAuthTokenSet> {
  const current = readOAuthTokensSync("openai", env);
  if (!current) throw new Error("No OpenAI subscription connected. Run: acolyte auth openai");
  if (current.expiresAt - EXPIRY_SKEW_MS > Date.now()) return current;

  if (!inflightRefresh) {
    inflightRefresh = refreshOAuthTokens(current, fetchFn)
      .then(async (next) => {
        await writeOAuthTokens("openai", next, env);
        return next;
      })
      .finally(() => {
        inflightRefresh = undefined;
      });
  }
  return inflightRefresh;
}

function applyAuthHeaders(init: RequestInit | undefined, tokens: OAuthTokenSet): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  headers.set("chatgpt-account-id", tokens.accountId);
  headers.set("originator", OPENAI_OAUTH_ORIGINATOR);
  return { ...init, headers };
}

export function withChatGPTAuthFetch(fetchFn: FetchFn, env?: Env): FetchFn {
  return async (input, init) => {
    const tokens = await ensureFreshTokens(fetchFn, env);
    const response = await fetchFn(input, applyAuthHeaders(init, tokens));
    if (response.status !== 401) return response;

    // A sibling process may have rotated the refresh token; re-read and retry once.
    const rotated = readOAuthTokensSync("openai", env);
    if (!rotated || rotated.accessToken === tokens.accessToken) return response;
    return fetchFn(input, applyAuthHeaders(init, rotated));
  };
}
