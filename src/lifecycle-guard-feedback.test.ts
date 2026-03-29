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
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent({ action: "flag_set" }));
    expect(feedback).toBeUndefined();
  });

  test("returns undefined for guard ids that lifecycle does not surface", () => {
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent({ guardId: "step-budget" }));
    expect(feedback).toBeUndefined();
  });

  test("maps duplicate-call to lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(createGuardEvent());
    expect(feedback?.source).toBe("guard");
    expect(feedback?.summary).toContain("file-read");
    expect(feedback?.instruction).toContain("Reuse the earlier result");
  });

  test("maps ping-pong to lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "ping-pong",
        toolName: "file-search",
        detail: "file-search<->file-find",
      }),
    );
    expect(feedback?.source).toBe("guard");
    expect(feedback?.summary).toContain("alternating");
  });

  test("maps post-edit redundancy to lifecycle feedback", () => {
    const feedback = createLifecycleFeedbackForGuard(
      createGuardEvent({
        guardId: "post-edit-redundancy",
        toolName: "file-delete",
        detail: "src/clamp.ts",
      }),
    );
    expect(feedback?.source).toBe("guard");
    expect(feedback?.summary).toContain("src/clamp.ts");
  });
});
