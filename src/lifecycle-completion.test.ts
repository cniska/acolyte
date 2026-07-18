import { describe, expect, test } from "bun:test";
import {
  classifyTerminalStep,
  createFinishPolicyState,
  decideFinish,
  renderReopenMessages,
} from "./lifecycle-completion";

describe("classifyTerminalStep", () => {
  test("accepts a written answer that stopped", () => {
    expect(classifyTerminalStep({ finalText: "Here is the answer.", finishReason: "stop" })).toEqual({
      kind: "accept",
    });
  });

  test("accepts unknown/absent reasons rather than failing new providers", () => {
    expect(classifyTerminalStep({ finalText: "Answer.", finishReason: "other" })).toEqual({ kind: "accept" });
    expect(classifyTerminalStep({ finalText: "Answer." })).toEqual({ kind: "accept" });
  });

  test("classifies a blank answer as incomplete empty-answer", () => {
    expect(classifyTerminalStep({ finalText: "   ", finishReason: "stop" })).toEqual({
      kind: "incomplete",
      reason: "empty-answer",
    });
  });

  test("classifies length as truncated before the blank check", () => {
    expect(classifyTerminalStep({ finalText: "half a sen", finishReason: "length" })).toEqual({
      kind: "incomplete",
      reason: "truncated",
    });
    // A length cut can leave blank text (budget spent on reasoning); still truncated, not empty.
    expect(classifyTerminalStep({ finalText: "", finishReason: "length" })).toEqual({
      kind: "incomplete",
      reason: "truncated",
    });
  });

  test("classifies content-filter and error as unrecoverable failures", () => {
    expect(classifyTerminalStep({ finalText: "", finishReason: "content-filter" })).toEqual({
      kind: "failed",
      reason: "content-filter",
    });
    expect(classifyTerminalStep({ finalText: "", finishReason: "error" })).toEqual({
      kind: "failed",
      reason: "provider-error",
    });
  });
});

describe("decideFinish", () => {
  test("finishes on an accepted step", () => {
    const state = createFinishPolicyState();
    expect(decideFinish({ state, step: { finalText: "Answer.", finishReason: "stop" } })).toEqual({ kind: "finish" });
  });

  test("empty-answer reopens once, then errors", () => {
    const state = createFinishPolicyState();
    const step = { finalText: "", finishReason: "stop" as const };
    expect(decideFinish({ state, step })).toEqual({ kind: "reopen", reason: "empty-answer" });
    expect(decideFinish({ state, step })).toEqual({ kind: "error", reason: "empty-answer" });
  });

  test("truncated reopens once, then errors", () => {
    const state = createFinishPolicyState();
    const step = { finalText: "half", finishReason: "length" as const };
    expect(decideFinish({ state, step })).toEqual({ kind: "reopen", reason: "truncated" });
    expect(decideFinish({ state, step })).toEqual({ kind: "error", reason: "truncated" });
  });

  test("reopen budgets are independent per reason", () => {
    const state = createFinishPolicyState();
    // Spend the empty-answer reopen.
    decideFinish({ state, step: { finalText: "", finishReason: "stop" } });
    // Truncation in the same turn still gets its own reopen.
    expect(decideFinish({ state, step: { finalText: "half", finishReason: "length" } })).toEqual({
      kind: "reopen",
      reason: "truncated",
    });
  });

  test("failures error immediately without consuming a reopen", () => {
    const state = createFinishPolicyState();
    expect(decideFinish({ state, step: { finalText: "", finishReason: "content-filter" } })).toEqual({
      kind: "error",
      reason: "content-filter",
    });
    expect(decideFinish({ state, step: { finalText: "", finishReason: "error" } })).toEqual({
      kind: "error",
      reason: "provider-error",
    });
  });
});

describe("renderReopenMessages", () => {
  test("renders only for reopen verdicts", () => {
    expect(renderReopenMessages({ kind: "finish" })).toEqual([]);
    expect(renderReopenMessages({ kind: "error", reason: "truncated" })).toEqual([]);
  });

  test("empty-answer nudge asks for the final response", () => {
    const text = JSON.stringify(renderReopenMessages({ kind: "reopen", reason: "empty-answer" }));
    expect(text).toContain("completion-rejected");
    expect(text).toContain("Write your final response");
  });

  test("truncated nudge asks to continue without repeating", () => {
    const text = JSON.stringify(renderReopenMessages({ kind: "reopen", reason: "truncated" }));
    expect(text).toContain("cut off");
    expect(text).toContain("Continue exactly from where it stopped");
  });
});
