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

    const retry = decideFinish({ state, hasWrites: false });
    const block = decideFinish({ state, hasWrites: false });

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

  test("done with writes injects self-review once", () => {
    const state = createFinishPolicyState();

    const first = decideFinish({ state, signal: "done", hasWrites: true });
    const second = decideFinish({ state, signal: "done", hasWrites: true });

    expect(first).toEqual({ kind: "self-review-inject" });
    expect(renderFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="task-self-review"') }],
    });
    expect(second).toEqual({ kind: "none" });
  });

  test("done without writes consumes self-review and records skip reason", () => {
    const state = createFinishPolicyState();

    const first = decideFinish({ state, signal: "done", hasWrites: false });
    const second = decideFinish({ state, signal: "done", hasWrites: true });

    expect(first).toEqual({ kind: "self-review-skip", reason: "no-writes" });
    expect(renderFinishPolicyMessages(first)).toEqual([]);
    expect(second).toEqual({ kind: "none" });
  });

  test("completion rejection gets one retry after self-review is exhausted", () => {
    const state = createFinishPolicyState(0);
    const completionBlock = {
      reason: "missing-validation-after-write" as const,
      message: "Cannot finish yet.",
      path: "src/app.ts",
    };

    const first = decideFinish({ state, signal: "done", hasWrites: true, completionBlock });
    const second = decideFinish({ state, signal: "done", hasWrites: true, completionBlock });

    expect(first).toEqual({ kind: "completion-rejected-continue", block: completionBlock });
    expect(renderFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="completion-rejected"') }],
    });
    expect(second).toEqual({ kind: "none" });
  });
});
