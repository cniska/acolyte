import { describe, expect, test } from "bun:test";
import { serverAppInternals } from "./server-app";

const { safeEqual, hasValidAuth } = serverAppInternals;

describe("safeEqual", () => {
  test("returns true for identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  test("returns false for different strings of same length", () => {
    expect(safeEqual("abc", "xyz")).toBe(false);
  });

  test("returns false for different lengths", () => {
    expect(safeEqual("short", "longer")).toBe(false);
  });

  test("returns true for empty strings", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("hasValidAuth", () => {
  // Note: hasValidAuth reads API_KEY from module scope at import time.
  // In tests, API keys are cleared by test-preload.ts, so API_KEY is undefined.
  // When no key is configured, all requests are allowed. Full keyed-path testing
  // requires the RPC integration tests which start a real server with a key.

  test("allows any request when no API key is configured", () => {
    const req = new Request("http://localhost/v1/status");
    expect(hasValidAuth(req)).toBe(true);
  });

  test("allows request without auth header when no key is configured", () => {
    const req = new Request("http://localhost/v1/chat", { method: "POST" });
    expect(hasValidAuth(req)).toBe(true);
  });
});
