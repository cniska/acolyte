import { describe, expect, test } from "bun:test";
import { clampSuggestionIndex } from "./chat-effects";

describe("chat effects helpers", () => {
  test("clampSuggestionIndex stays within available suggestion range", () => {
    expect(clampSuggestionIndex(3, 2)).toBe(1);
    expect(clampSuggestionIndex(-2, 2)).toBe(0);
    expect(clampSuggestionIndex(0, 0)).toBe(0);
  });
});
