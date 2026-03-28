import { describe, expect, test } from "bun:test";
import { createLifecycleFeedbackForGuard } from "./lifecycle-guard-feedback";
import type { GuardEvent } from "./tool-guards";

function createGuardEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    guardId: "duplicate-call",
    toolName: "file-read",
    action: "blocked",
    detail: "duplicate-call",
    ...overrides,
  };
}

describe("createLifecycleFeedbackForGuard", () => {
  test("returns undefined for non-blocking guard events", () => {
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent({ action: "flag_set" }), "work");
    expect(feedback).toBeUndefined();
  });

  test("returns undefined for guard ids that lifecycle does not surface", () => {
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent({ guardId: "step-budget" }), "work");
    expect(feedback).toBeUndefined();
  });

  test("maps duplicate-call to work-scoped lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent(), "work");
    expect(feedback).toEqual({
      source: "guard",
      mode: "work",
      summary: "The previous file-read call already used these arguments.",
      instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
    });
  });

  test("maps ping-pong detail into lifecycle feedback details", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "ping-pong",
        toolName: "file-search",
        detail: "file-search<->file-find",
      }),
      "work",
    );
    expect(feedback).toEqual({
      source: "guard",
      mode: "work",
      summary: "You are alternating between the same tools without changing strategy.",
      details: "Recent calls are bouncing between file-search<->file-find.",
      instruction: "Stop repeating the same pattern. Change approach or change inputs.",
    });
  });

  test("maps post-edit file-delete to work-scoped lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "post-edit-redundancy",
        toolName: "file-delete",
        detail: "src/clamp.ts",
      }),
      "work",
    );
    expect(feedback).toEqual({
      source: "guard",
      mode: "work",
      summary: 'A previous edit already changed "src/clamp.ts".',
      instruction: "Do not undo or discard the file after a successful edit. Keep it and revise it in place if needed.",
    });
  });

  test("maps verify rediscovery to verify-scoped lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "verify-rediscovery",
        toolName: "file-search",
        detail: "src/lifecycle-state.ts",
      }),
      "verify",
    );
    expect(feedback).toEqual({
      source: "guard",
      mode: "verify",
      summary: 'Verify already has enough evidence for "src/lifecycle-state.ts".',
      instruction:
        "Do not rediscover that edited file in verify mode. Conclude from code-scan, test-run, and the existing edit preview.",
    });
  });
});
