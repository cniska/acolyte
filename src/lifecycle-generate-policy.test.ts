import { describe, expect, test } from "bun:test";
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

  test("a written final response completes immediately", () => {
    const state = createFinishPolicyState();
    expect(decideFinish({ state })).toEqual({ kind: "none" });
  });

  test("empty-answer rejection gets one retry before blocking completion", () => {
    const state = createFinishPolicyState();
    const completionBlock = { reason: "empty-answer" as const };

    const first = decideFinish({ state, completionBlock });
    const second = decideFinish({ state, completionBlock });

    expect(first).toEqual({ kind: "completion-rejected-continue", block: completionBlock });
    expect(renderFinishPolicyMessages(first)[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining('type="completion-rejected"') }],
    });
    // Retry spent with the block still standing: enforcement is terminal in-stream, not a
    // post-hoc re-check. No model-facing prose leaks — the user-audience message is rendered
    // by the caller from the returned block.
    expect(second).toEqual({ kind: "completion-block", block: completionBlock });
    expect(renderFinishPolicyMessages(second)).toEqual([]);
  });

  test("empty-answer rejection asks for a final response", () => {
    const rendered = renderFinishPolicyMessages({
      kind: "completion-rejected-continue",
      block: { reason: "empty-answer" },
    });
    const text = JSON.stringify(rendered);

    expect(text).toContain("Write your final response");
    expect(text).toContain("without writing a final response");
  });
});
