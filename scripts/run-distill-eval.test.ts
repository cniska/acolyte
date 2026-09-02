import { describe, expect, test } from "bun:test";
import type { DistillFixture } from "./distill-eval-fixtures";
import { redProof } from "./run-distill-eval";

function fixture(overrides: Partial<DistillFixture> = {}): DistillFixture {
  return {
    id: "f1",
    provenance: { source: "claude-code", sessionId: "s", turnIndex: 0, capturedAt: "2026-09-02T00:00:00.000Z" },
    messages: [{ role: "user", content: "the staleness budget is 50 commits past the session" }],
    output: "recorded",
    expected: [],
    mustNot: [],
    ...overrides,
  };
}

describe("redProof", () => {
  test("passes a fixture whose recorded corruption the quote check catches", () => {
    expect(redProof([fixture({ measuredFailure: "the budget is 50 turns" })])).toEqual([]);
  });

  test("names a fixture whose recorded corruption nothing catches any more", () => {
    expect(redProof([fixture({ measuredFailure: "the budget is 50 commits" })])).toEqual(["f1"]);
  });

  test("passes a fixture that records no corruption to replay", () => {
    expect(redProof([fixture()])).toEqual([]);
  });

  test("catches a corruption through the fixture's own mustNot label", () => {
    const labeled = fixture({ measuredFailure: "Plan: rewrite the reader", mustNot: ["/^plan:/i"] });
    expect(redProof([labeled])).toEqual([]);
  });
});
