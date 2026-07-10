import { describe, expect, test } from "bun:test";
import { truncateMiddle, truncateText, truncateToWidth } from "./truncate-text";

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

  test("returns marker when maxChars is smaller than marker", () => {
    const result = truncateMiddle("x".repeat(100), 5);
    expect(result).toContain("chars truncated");
  });

  test("handles empty string", () => {
    expect(truncateMiddle("", 100)).toBe("");
  });
});

describe("truncateToWidth", () => {
  test("returns input unchanged when within width", () => {
    expect(truncateToWidth("hello", 10)).toBe("hello");
    expect(truncateToWidth("hello", 5)).toBe("hello");
  });

  test("cuts with a trailing ellipsis when over width", () => {
    expect(truncateToWidth("abcdef", 4)).toBe("abc…");
  });

  test("result never exceeds the target width", () => {
    const out = truncateToWidth("x".repeat(100), 20);
    expect(out).toBe(`${"x".repeat(19)}…`);
    expect(Bun.stringWidth(out)).toBe(20);
  });

  test("returns empty string for non-positive width", () => {
    expect(truncateToWidth("abc", 0)).toBe("");
    expect(truncateToWidth("abc", -5)).toBe("");
  });

  test("counts wide (CJK) characters by display width, not code points", () => {
    const wide = "一二三四"; // 4 code points, 8 display columns
    expect(truncateToWidth(wide, 8)).toBe(wide);
    // budget 5 reserves 1 column for the ellipsis, leaving 4 columns = 2 wide chars
    expect(truncateToWidth(wide, 5)).toBe("一二…");
  });

  test("never splits a surrogate-pair grapheme mid-character", () => {
    const out = truncateToWidth("🙂".repeat(5), 5);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("�");
    expect(Bun.stringWidth(out)).toBeLessThanOrEqual(5);
  });

  test("handles empty string", () => {
    expect(truncateToWidth("", 10)).toBe("");
  });
});
