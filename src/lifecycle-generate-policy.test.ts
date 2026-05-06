import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import {
  createGenerateFinishPolicyState,
  createGeneratePromptCacheKey,
  decideGenerateFinish,
  renderGenerateFinishPolicyMessages,
} from "./lifecycle-generate-policy";

describe("generate finish policy", () => {
  test("creates a stable prompt cache key for generate calls", () => {
    const key = createGeneratePromptCacheKey({
      model: "gpt-5.4",
      sessionId: "session-123",
      workspace: "/repo",
    });

    expect(key).toBe(createGeneratePromptCacheKey({ model: "gpt-5.4", sessionId: "session-123", workspace: "/repo" }));
    expect(key).not.toBe(
      createGeneratePromptCacheKey({ model: "gpt-5.4", sessionId: "session-456", workspace: "/repo" }),
    );
  });

  test("missing signal gets one retry before blocking completion", () => {
    const state = createGenerateFinishPolicyState();

    const retry = decideGenerateFinish({ state, hasWrites: false });
    const block = decideGenerateFinish({ state, hasWrites: false });

    expect(retry).toMatchObject({ kind: "missing-signal-continue" });
    expect(renderGenerateFinishPolicyMessages(retry)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="missing-signal"') }],
    });
    expect(block).toEqual({
      kind: "missing-signal-block",
      message:
        "Cannot finish yet: final responses must call exactly one lifecycle signal tool (`signal_done`, `signal_noop`, or `signal_blocked`).",
      code: LIFECYCLE_ERROR_CODES.unknown,
    });
    expect(renderGenerateFinishPolicyMessages(block)).toEqual([]);
  });

  test("done with writes injects self-review once", () => {
    const state = createGenerateFinishPolicyState();

    const first = decideGenerateFinish({ state, signal: "done", hasWrites: true });
    const second = decideGenerateFinish({ state, signal: "done", hasWrites: true });

    expect(first).toEqual({ kind: "self-review-inject" });
    expect(renderGenerateFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="task-self-review"') }],
    });
    expect(second).toEqual({ kind: "none" });
  });

  test("done without writes consumes self-review and records skip reason", () => {
    const state = createGenerateFinishPolicyState();

    const first = decideGenerateFinish({ state, signal: "done", hasWrites: false });
    const second = decideGenerateFinish({ state, signal: "done", hasWrites: true });

    expect(first).toEqual({ kind: "self-review-skip", reason: "no-writes" });
    expect(renderGenerateFinishPolicyMessages(first)).toEqual([]);
    expect(second).toEqual({ kind: "none" });
  });

  test("completion rejection gets one retry after self-review is exhausted", () => {
    const state = createGenerateFinishPolicyState(0);
    const completionBlock = {
      reason: "missing-validation-after-write" as const,
      message: "Cannot finish yet.",
      path: "src/app.ts",
    };

    const first = decideGenerateFinish({ state, signal: "done", hasWrites: true, completionBlock });
    const second = decideGenerateFinish({ state, signal: "done", hasWrites: true, completionBlock });

    expect(first).toEqual({ kind: "completion-rejected-continue", block: completionBlock });
    expect(renderGenerateFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="completion-rejected"') }],
    });
    expect(second).toEqual({ kind: "none" });
  });
});
