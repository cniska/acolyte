import { describe, expect, test } from "bun:test";
import { hasValidAuth, safeEqual } from "./server-auth";

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
  test("allows any request when no API key is configured", () => {
    const req = new Request("http://localhost/v1/status");
    expect(hasValidAuth(req, undefined)).toBe(true);
  });

  test("accepts correct bearer token", () => {
    const req = new Request("http://localhost/v1/status", {
      headers: { authorization: "Bearer test-key" },
    });
    expect(hasValidAuth(req, "test-key")).toBe(true);
  });

  test("rejects wrong bearer token", () => {
    const req = new Request("http://localhost/v1/status", {
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(hasValidAuth(req, "test-key")).toBe(false);
  });

  test("rejects missing auth header when key is set", () => {
    const req = new Request("http://localhost/v1/status");
    expect(hasValidAuth(req, "test-key")).toBe(false);
  });

  test("accepts correct WebSocket protocol auth", () => {
    const req = new Request("http://localhost/v1/rpc", {
      headers: { "sec-websocket-protocol": "bearer.test-key" },
    });
    expect(hasValidAuth(req, "test-key")).toBe(true);
  });

  test("rejects wrong WebSocket protocol auth", () => {
    const req = new Request("http://localhost/v1/rpc", {
      headers: { "sec-websocket-protocol": "bearer.wrong-key" },
    });
    expect(hasValidAuth(req, "test-key")).toBe(false);
  });
});
