import { describe, expect, test } from "bun:test";
import { oauthStoreSchema, oauthTokenSetSchema } from "./oauth-store-contract";

const validTokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: 1_700_000_000_000,
  accountId: "acct_1",
};

describe("oauthTokenSetSchema", () => {
  test("accepts a complete token set", () => {
    expect(oauthTokenSetSchema.parse(validTokens)).toEqual(validTokens);
  });

  test("rejects empty strings", () => {
    expect(oauthTokenSetSchema.safeParse({ ...validTokens, accessToken: "" }).success).toBe(false);
    expect(oauthTokenSetSchema.safeParse({ ...validTokens, accountId: "" }).success).toBe(false);
  });

  test("rejects a missing refresh token", () => {
    const { refreshToken, ...rest } = validTokens;
    expect(oauthTokenSetSchema.safeParse(rest).success).toBe(false);
  });

  test("rejects a non-integer expiry", () => {
    expect(oauthTokenSetSchema.safeParse({ ...validTokens, expiresAt: 1.5 }).success).toBe(false);
  });
});

describe("oauthStoreSchema", () => {
  test("accepts an empty versioned store", () => {
    expect(oauthStoreSchema.parse({ version: 1 })).toEqual({ version: 1 });
  });

  test("accepts a store with openai tokens", () => {
    expect(oauthStoreSchema.parse({ version: 1, openai: validTokens }).openai).toEqual(validTokens);
  });

  test("rejects an unknown version", () => {
    expect(oauthStoreSchema.safeParse({ version: 2 }).success).toBe(false);
  });

  test("rejects a malformed openai entry", () => {
    expect(oauthStoreSchema.safeParse({ version: 1, openai: { accessToken: "a" } }).success).toBe(false);
  });
});
