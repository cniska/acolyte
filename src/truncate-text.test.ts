import { describe, expect, test } from "bun:test";
import { truncateText } from "./truncate-text";

describe("truncateText", () => {
  test("returns input unchanged when within limit", () => {
    expect(truncateText("short")).toBe("short");
    expect(truncateText("ab", 4)).toBe("ab");
  });

  test("truncates with ellipsis when over limit", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
  });

  test("uses default max of 80 chars", () => {
    const input = "a".repeat(100);
    const result = truncateText(input);
    expect(result.length).toBe(80);
    expect(result.endsWith("…")).toBe(true);
  });

  test("handles edge case of maxChars 1", () => {
    expect(truncateText("abc", 1)).toBe("…");
  });

  test("handles empty string", () => {
    expect(truncateText("")).toBe("");
  });
});
