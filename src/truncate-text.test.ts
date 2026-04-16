import { describe, expect, test } from "bun:test";
import { truncateMiddle, truncateText } from "./truncate-text";

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

describe("truncateMiddle", () => {
  test("returns input unchanged when under limit", () => {
    expect(truncateMiddle("short", 100)).toBe("short");
  });

  test("returns input unchanged when exactly at limit", () => {
    const input = "a".repeat(50);
    expect(truncateMiddle(input, 50)).toBe(input);
  });

  test("truncates with head/tail split when over limit", () => {
    const input = "H".repeat(500) + "M".repeat(500) + "T".repeat(500);
    const result = truncateMiddle(input, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain("… ");
    expect(result).toContain("chars truncated …");
    expect(result.startsWith("H")).toBe(true);
    expect(result.endsWith("T")).toBe(true);
  });

  test("marker includes truncated character count", () => {
    const input = "x".repeat(1000);
    const result = truncateMiddle(input, 200);
    expect(result).toContain("800 chars truncated");
  });

  test("head portion is larger than tail (60/40 split)", () => {
    const input = "H".repeat(5000) + "T".repeat(5000);
    const result = truncateMiddle(input, 200);
    const markerStart = result.indexOf("\n… ");
    const markerEnd = result.indexOf("truncated …\n") + "truncated …\n".length;
    const headSize = markerStart;
    const tailSize = result.length - markerEnd;
    expect(headSize).toBeGreaterThan(tailSize);
  });

  test("handles empty string", () => {
    expect(truncateMiddle("", 100)).toBe("");
  });
});
