import { describe, expect, test } from "bun:test";
import { clampToTokenEstimate } from "./distill-ops";

describe("clampToTokenEstimate", () => {
  test("does not produce lone surrogates when clamping emoji text", () => {
    const mixed = "a🎉".repeat(200);
    const result = clampToTokenEstimate(mixed, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
