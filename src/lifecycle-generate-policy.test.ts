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
    expect(block).toEqual({ kind: "missing-signal-block", code: LIFECYCLE_ERROR_CODES.unknown });
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
    // Retry spent with the block still standing: enforcement is terminal in-stream, not a
    // post-hoc re-check. No model-facing prose leaks — the user-audience message is rendered
    // by the caller from the returned block.
    expect(second).toEqual({ kind: "completion-block", block: completionBlock });
    expect(renderFinishPolicyMessages(second)).toEqual([]);
  });

  test("empty-answer rejection asks for a final response, not validation", () => {
    const rendered = renderFinishPolicyMessages({
      kind: "completion-rejected-continue",
      block: { reason: "empty-answer", path: "", signal: "done" },
    });
    const text = JSON.stringify(rendered);

    expect(text).toContain("Write your final response");
    expect(text).not.toContain("run focused validation");
  });

  test("empty-answer follow-up is signal-agnostic (does not hardcode signal_done for a noop)", () => {
    const rendered = renderFinishPolicyMessages({
      kind: "completion-rejected-continue",
      block: { reason: "empty-answer", path: "", signal: "noop" },
    });
    const text = JSON.stringify(rendered);

    expect(text).toContain("Write your final response");
    // The model-facing text must be the noop variant and must not name `signal_done`.
    expect(text).toContain("signal_noop");
    expect(text).not.toContain("signal_done");
  });

  test("re-opening the loop restores the spent missing-signal retry", () => {
    // Regression (dogfood): a missing-signal retry consumed before a completion-rejected
    // re-entry must not carry over, or a prose reply to the reminder blocks with
    // "Cannot finish yet" despite a valid earlier signal.
    const state = createFinishPolicyState();
    const completionBlock = {
      reason: "missing-validation-after-write" as const,
      path: "src/app.ts",
    };

    expect(decideFinish({ state })).toMatchObject({ kind: "missing-signal-continue" });
    expect(decideFinish({ state, signal: "done", completionBlock })).toMatchObject({
      kind: "completion-rejected-continue",
    });
    expect(decideFinish({ state })).toMatchObject({ kind: "missing-signal-continue" });
  });
});
