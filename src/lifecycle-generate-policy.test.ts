import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { createFinishPolicyState, decideFinish, renderFinishPolicyMessages } from "./lifecycle-generate-policy";
import { createPromptCacheKey } from "./prompt-cache";

describe("generate finish policy", () => {
  test("creates a stable prompt cache key for generate calls", () => {
    const key = createPromptCacheKey({
      model: "gpt-5.4",
      sessionId: "session-123",
      workspace: "/repo",
    });

    expect(key).toBe(createPromptCacheKey({ model: "gpt-5.4", sessionId: "session-123", workspace: "/repo" }));
    expect(key).not.toBe(createPromptCacheKey({ model: "gpt-5.4", sessionId: "session-456", workspace: "/repo" }));
  });

  test("missing signal gets one retry before blocking completion", () => {
    const state = createFinishPolicyState();

    const retry = decideFinish({ state });
    const block = decideFinish({ state });

    expect(retry).toMatchObject({ kind: "missing-signal-continue" });
    expect(renderFinishPolicyMessages(retry)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="missing-signal"') }],
    });
    expect(block).toEqual({
      kind: "missing-signal-block",
      message:
        "Cannot finish yet: final responses must call exactly one lifecycle signal tool (`signal_done`, `signal_noop`, or `signal_blocked`).",
      code: LIFECYCLE_ERROR_CODES.unknown,
    });
    expect(renderFinishPolicyMessages(block)).toEqual([]);
  });

  test("done completes immediately when completion evidence is present", () => {
    const state = createFinishPolicyState();

    expect(decideFinish({ state, signal: "done" })).toEqual({ kind: "none" });
  });

  test("completion rejection gets one retry", () => {
    const state = createFinishPolicyState();
    const completionBlock = {
      reason: "missing-validation-after-write" as const,
      message: "Cannot finish yet.",
      path: "src/app.ts",
    };

    const first = decideFinish({ state, signal: "done", completionBlock });
    const second = decideFinish({ state, signal: "done", completionBlock });

    expect(first).toEqual({ kind: "completion-rejected-continue", block: completionBlock });
    expect(renderFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="completion-rejected"') }],
    });
    expect(renderFinishPolicyMessages(first)[0]).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("signal_done") }],
    });
    expect(second).toEqual({ kind: "none" });
  });

  test("empty-answer rejection asks for a final response, not validation", () => {
    const rendered = renderFinishPolicyMessages({
      kind: "completion-rejected-continue",
      block: {
        reason: "empty-answer",
        message: "Cannot finish yet: you called `signal_done` without writing a final response to the user.",
        path: "",
      },
    });
    const text = JSON.stringify(rendered);

    expect(text).toContain("Write your final response");
    expect(text).not.toContain("run focused validation");
  });

  test("re-opening the loop restores the spent missing-signal retry", () => {
    // Regression (dogfood): a missing-signal retry consumed before a completion-rejected
    // re-entry must not carry over, or a prose reply to the reminder blocks with
    // "Cannot finish yet" despite a valid earlier signal.
    const state = createFinishPolicyState();
    const completionBlock = {
      reason: "missing-validation-after-write" as const,
      message: "Cannot finish yet.",
      path: "src/app.ts",
    };

    expect(decideFinish({ state })).toMatchObject({ kind: "missing-signal-continue" });
    expect(decideFinish({ state, signal: "done", completionBlock })).toMatchObject({
      kind: "completion-rejected-continue",
    });
    expect(decideFinish({ state })).toMatchObject({ kind: "missing-signal-continue" });
  });
});
