import { describe, expect, test } from "bun:test";
import { createLifecycleFeedbackForGuard } from "./lifecycle-guard-feedback";
import type { GuardEvent } from "./tool-guards";

function createGuardEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    guardId: "duplicate-call",
    toolName: "read-file",
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
      summary: "The previous read-file call already used these arguments.",
      instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
    });
  });

  test("maps ping-pong detail into lifecycle feedback details", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "ping-pong",
        toolName: "search-files",
        detail: "search-files<->find-files",
      }),
      "work",
    );
    expect(feedback).toEqual({
      source: "guard",
      mode: "work",
      summary: "You are alternating between the same tools without changing strategy.",
      details: "Recent calls are bouncing between search-files<->find-files.",
      instruction: "Stop repeating the same pattern. Change approach or change inputs.",
    });
  });

  test("forces verify mode for redundant-verify feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "redundant-verify",
        toolName: "run-command",
        detail: "no-writes-since-last-verify",
      }),
      "work",
    );
    expect(feedback).toEqual({
      source: "guard",
      mode: "verify",
      summary: "This verify command already ran and no writes happened since then.",
      instruction: "Do not rerun the same verification command until work mode changes the code.",
    });
  });
});
