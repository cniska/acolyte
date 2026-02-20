import { describe, expect, test } from "bun:test";
import { clampSuggestionIndex, nextThinkingFrame } from "./chat-effects";

describe("chat effects helpers", () => {
  test("clampSuggestionIndex stays within available suggestion range", () => {
    expect(clampSuggestionIndex(3, 2)).toBe(1);
    expect(clampSuggestionIndex(-2, 2)).toBe(0);
    expect(clampSuggestionIndex(0, 0)).toBe(0);
  });

  test("nextThinkingFrame wraps around frame count", () => {
    expect(nextThinkingFrame(0, 10)).toBe(1);
    expect(nextThinkingFrame(9, 10)).toBe(0);
  });
});
