import { describe, expect, test } from "bun:test";
import { userResourceIdForSubject } from "./resource-id";
import { userScopeForToken } from "./user-identity";

const SUBJECT = "012627e3-1df9-476a-919d-f208a6bb9830";

/** A token in the shape the cloud mints: header, claims, signature. Only the claims are read. */
function tokenFor(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "EdDSA" })}.${part(claims)}.c2lnbmF0dXJl`;
}

describe("userScopeForToken", () => {
  test("names the account its token names", () => {
    const token = tokenFor({ sub: SUBJECT, scope: "user", exp: 1788247950 });
    expect(userScopeForToken(token)).toBe(userResourceIdForSubject(SUBJECT));
  });

  test("keeps the account across expiry, so the scope never flips while a credential is stale", () => {
    const live = tokenFor({ sub: SUBJECT, exp: 4102444800 });
    const expired = tokenFor({ sub: SUBJECT, exp: 1 });
    expect(userScopeForToken(expired)).toBe(userScopeForToken(live));
  });

  test("falls to the installation's own scope with no token, or one that names no account", () => {
    expect(userScopeForToken("")).toBe("user_local");
    expect(userScopeForToken("not-a-jwt")).toBe("user_local");
    expect(userScopeForToken(tokenFor({ scope: "user" }))).toBe("user_local");
  });
});
