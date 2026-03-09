import { describe, expect, test } from "bun:test";
import { suggestModels } from "./chat-model-autocomplete";

const MODELS = [
  "claude-opus-4-6-20250904",
  "claude-sonnet-4-6-20250904",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.2",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

describe("suggestModels", () => {
  test("returns all models when query is empty", () => {
    expect(suggestModels("", MODELS)).toEqual(MODELS);
  });

  test("prefix match ranks highest", () => {
    const results = suggestModels("gpt", MODELS);
    expect(results[0]).toBe("gpt-5.2");
    expect(results.every((r) => r.includes("gpt"))).toBe(true);
  });

  test("contains match ranks after prefix", () => {
    const results = suggestModels("flash", MODELS);
    expect(results).toEqual(["gemini-2.0-flash"]);
  });

  test("subsequence match works", () => {
    const results = suggestModels("cso", MODELS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.includes("claude-sonnet"))).toBe(true);
  });

  test("no match returns empty", () => {
    expect(suggestModels("zzz", MODELS)).toEqual([]);
  });
});
