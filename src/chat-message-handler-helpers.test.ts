import { describe, expect, test } from "bun:test";
import {
  buildInternalWriteResumeTurn,
  formatSubmitError,
  isAbortError,
  mergeAssistantTranscript,
  parseInternalWriteResumeTurn,
} from "./chat-message-handler-helpers";

describe("chat-message-handler-helpers", () => {
  test("build/parse internal write resume turn round-trips", () => {
    const payload = buildInternalWriteResumeTurn("edit src/a.ts");
    expect(parseInternalWriteResumeTurn(payload)).toEqual({ prompt: "edit src/a.ts" });
    expect(parseInternalWriteResumeTurn(buildInternalWriteResumeTurn("   "))).toBeNull();
  });

  test("isAbortError classifies abort-like errors", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("request aborted by user"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  test("formatSubmitError maps known user-facing failures", () => {
    expect(formatSubmitError(new Error("insufficient_quota: exceeded"))).toContain("Provider quota exceeded");
    expect(formatSubmitError(new Error("timeout after 10s"))).toContain("timed out");
  });

  test("mergeAssistantTranscript merges overlap correctly", () => {
    expect(mergeAssistantTranscript("", "final")).toBe("final");
    expect(mergeAssistantTranscript("hel", "hello")).toBe("hello");
    expect(mergeAssistantTranscript("hello", "hello")).toBe("hello");
    expect(mergeAssistantTranscript("hello world", "world peace")).toBe("hello world peace");
  });
});
