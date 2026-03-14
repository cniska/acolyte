import { describe, expect, test } from "bun:test";
import { suggestModels } from "./chat-model-autocomplete";

const MODELS = [
  { label: "claude-opus-4-6-20250904", value: "anthropic/claude-opus-4-6-20250904" },
  { label: "claude-sonnet-4-6-20250904", value: "anthropic/claude-sonnet-4-6-20250904" },
  { label: "gpt-5-mini", value: "openai/gpt-5-mini" },
  { label: "gpt-5-nano", value: "openai/gpt-5-nano" },
  { label: "gpt-5.2", value: "openai/gpt-5.2" },
  { label: "gemini-2.0-flash", value: "google/gemini-2.0-flash" },
  { label: "gemini-2.5-pro", value: "google/gemini-2.5-pro" },
];

describe("suggestModels", () => {
  test("returns all models when query is empty", () => {
    expect(suggestModels("", MODELS)).toEqual(MODELS);
  });

  test("prefix match ranks highest", () => {
    const results = suggestModels("gpt", MODELS);
    expect(results[0]?.label).toBe("gpt-5.2");
    expect(results.every((r) => r.label.includes("gpt"))).toBe(true);
  });

  test("contains match ranks after prefix", () => {
    const results = suggestModels("flash", MODELS);
    expect(results).toEqual([{ label: "gemini-2.0-flash", value: "google/gemini-2.0-flash" }]);
  });

  test("subsequence match works", () => {
    const results = suggestModels("cso", MODELS);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.label.includes("claude-sonnet"))).toBe(true);
  });

  test("no match returns empty", () => {
    expect(suggestModels("zzz", MODELS)).toEqual([]);
  });
});
