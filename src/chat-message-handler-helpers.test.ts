import { describe, expect, test } from "bun:test";
import { formatSubmitError, isAbortError } from "./chat-message-handler-helpers";

describe("chat-message-handler-helpers", () => {
  test("isAbortError classifies abort-like errors", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("request aborted by user"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  test("formatSubmitError maps known user-facing failures", () => {
    expect(formatSubmitError(new Error("insufficient_quota: exceeded"))).toContain("Provider quota exceeded");
    expect(formatSubmitError(new Error("timeout after 10s"))).toContain("timed out");
  });
});
