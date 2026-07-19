import { describe, expect, test } from "bun:test";
import { MAX_CONTEXT_INPUT_TOKENS } from "./lifecycle-constants";
import { createLifecyclePolicy, defaultLifecyclePolicy } from "./lifecycle-policy";

describe("createLifecyclePolicy", () => {
  test("uses the flat context input budget by default", () => {
    expect(createLifecyclePolicy().contextMaxTokens).toBe(MAX_CONTEXT_INPUT_TOKENS);
    expect(defaultLifecyclePolicy.contextMaxTokens).toBe(MAX_CONTEXT_INPUT_TOKENS);
  });

  // Regression: the budget must not vary by model. A per-model window table over-budgeted gpt-5
  // (400k window * 0.85 = 340k > its 272k input cap); a single flat ceiling can't drift that way.
  test("does not vary the context budget by model", () => {
    expect(createLifecyclePolicy().contextMaxTokens).toBe(createLifecyclePolicy().contextMaxTokens);
    expect(MAX_CONTEXT_INPUT_TOKENS).toBeLessThan(272_000);
  });

  test("explicit override wins", () => {
    expect(createLifecyclePolicy({ contextMaxTokens: 12_345 }).contextMaxTokens).toBe(12_345);
  });
});
