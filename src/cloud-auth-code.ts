import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { CodedError } from "./coded-error";
import { LOGIN_ERROR_CODES } from "./error-contract";

const EXCHANGE_ROUTE = "/api/v1/auth/cli-token/exchange";

const exchangeResponseSchema = z.object({
  token: z.string().min(1),
  refresh: z.string().min(1),
  email: z.string(),
});

export type CloudTokens = z.infer<typeof exchangeResponseSchema>;

/** The secret half of the handoff. It never leaves this process, so a code alone buys nobody anything. */
export function createVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Trades the code the browser carried back for the account's tokens. A cloud with no exchange route
 * predates the handshake, and says so as a login failure rather than as an unreadable response.
 */
export async function exchangeAuthCode(
  baseUrl: string,
  code: string,
  verifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<CloudTokens> {
  const response = await fetchFn(`${baseUrl.replace(/\/$/, "")}${EXCHANGE_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });

  if (response.status === 404) {
    throw new CodedError(LOGIN_ERROR_CODES.exchangeUnsupported, "this cloud has no code exchange");
  }
  if (!response.ok) {
    throw new CodedError(LOGIN_ERROR_CODES.exchangeRefused, `the cloud refused the sign-in (${response.status})`);
  }

  const parsed = exchangeResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new CodedError(LOGIN_ERROR_CODES.exchangeRefused, "the cloud returned no tokens");
  }
  return parsed.data;
}
