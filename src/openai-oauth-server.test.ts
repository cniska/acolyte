import { describe, expect, test } from "bun:test";
import { classifyCallback } from "./openai-oauth-server";

function callbackUrl(query: Record<string, string>): URL {
  const url = new URL("http://127.0.0.1:1455/auth/callback");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

describe("classifyCallback", () => {
  test("returns the code on a valid callback", () => {
    expect(classifyCallback(callbackUrl({ code: "abc", state: "st" }), "st")).toEqual({ ok: true, code: "abc" });
  });

  test("rejects a state mismatch", () => {
    expect(classifyCallback(callbackUrl({ code: "abc", state: "wrong" }), "st")).toEqual({
      ok: false,
      message: "state mismatch",
    });
  });

  test("rejects a missing state", () => {
    expect(classifyCallback(callbackUrl({ code: "abc" }), "st").ok).toBe(false);
  });

  test("surfaces a provider error param", () => {
    expect(classifyCallback(callbackUrl({ error: "access_denied", state: "st" }), "st")).toEqual({
      ok: false,
      message: "access_denied",
    });
  });

  test("rejects a missing code", () => {
    expect(classifyCallback(callbackUrl({ state: "st" }), "st")).toEqual({
      ok: false,
      message: "missing authorization code",
    });
  });
});
