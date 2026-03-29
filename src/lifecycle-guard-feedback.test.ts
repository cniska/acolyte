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
    expect(feedback?.source).toBe("guard");
    expect(feedback?.mode).toBe("work");
    expect(feedback?.summary).toContain("file-read");
    expect(feedback?.instruction).toContain("Reuse the earlier result");
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
    expect(feedback?.source).toBe("guard");
    expect(feedback?.mode).toBe("work");
    expect(feedback?.summary).toContain("alternating");
    expect(feedback?.details).toContain("file-search<->file-find");
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
    expect(feedback?.source).toBe("guard");
    expect(feedback?.mode).toBe("work");
    expect(feedback?.summary).toContain("src/clamp.ts");
    expect(feedback?.instruction).toContain("Do not undo");
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
    expect(feedback?.source).toBe("guard");
    expect(feedback?.mode).toBe("verify");
    expect(feedback?.summary).toContain("src/lifecycle-state.ts");
    expect(feedback?.instruction).toContain("Do not rediscover");
  });
});
