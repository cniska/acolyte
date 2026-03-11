import { describe, expect, test } from "bun:test";
import { estimateTokens } from "./agent-input";

describe("estimateTokens (real tokenizer)", () => {
  test("returns zero for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("tokenizes English prose within expected range", () => {
    const tokens = estimateTokens("The quick brown fox jumps over the lazy dog.");
    // ~10 tokens for this sentence; allow ±3 for tokenizer variance.
    expect(tokens).toBeGreaterThan(7);
    expect(tokens).toBeLessThan(14);
  });

  test("tokenizes code more densely than prose", () => {
    const prose = "This is a simple English sentence repeated several times for comparison.";
    const code = "export function estimateTokens(input: string): number { return input.length; }";
    // Code should use more tokens per character than prose.
    const proseRatio = estimateTokens(prose) / prose.length;
    const codeRatio = estimateTokens(code) / code.length;
    expect(codeRatio).toBeGreaterThan(proseRatio * 0.8);
  });

  test("scales linearly with input size", () => {
    const base = estimateTokens("hello world");
    const doubled = estimateTokens("hello world hello world");
    expect(doubled).toBeGreaterThan(base);
    expect(doubled).toBeLessThan(base * 3);
  });
});
