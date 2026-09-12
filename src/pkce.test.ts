import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { challengeFor, createHandoffState, createPkce } from "./pkce";

describe("pkce", () => {
  test("a verifier uses only base64url-safe characters and is long enough", () => {
    const { verifier } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  test("a verifier never repeats", () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
  });

  // Against an independent implementation: the cloud checks this hash with its own crypto, so a
  // pair that only agrees with itself would pass here and fail every real sign-in.
  test("the challenge is the base64url sha-256 of the verifier", () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challengeFor(verifier)).toBe(challenge);
  });
});

describe("createHandoffState", () => {
  test("draws 256 bits from the same source as the verifier", () => {
    const state = createHandoffState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("gives every handoff its own value", () => {
    const states = new Set(Array.from({ length: 100 }, () => createHandoffState()));
    expect(states.size).toBe(100);
  });
});
