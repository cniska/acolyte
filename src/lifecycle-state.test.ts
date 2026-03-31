import { describe, expect, test } from "bun:test";
import { acceptedLifecycleSignal } from "./lifecycle-state";
import { createRunContext } from "./test-utils";
import { createSessionContext, recordCall } from "./tool-session";

describe("acceptedLifecycleSignal", () => {
  test("accepts done when no contradiction exists", () => {
    const ctx = createRunContext({
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBe("done");
  });

  test("accepts blocked when no contradiction exists", () => {
    const ctx = createRunContext({
      result: { text: "Blocked by a missing file.", toolCalls: [], signal: "blocked" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBe("blocked");
  });

  test("rejects no_op after writes happened", () => {
    const session = createSessionContext("task_noop");
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-edit", { path: "src/a.ts" });
    const ctx = createRunContext({
      taskId: "task_noop",
      session,
      result: { text: "No changes were needed.", toolCalls: [], signal: "no_op" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("rejects any signal when a current error exists", () => {
    const ctx = createRunContext({
      currentError: { message: "verify failed", category: "other" },
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("rejects done after a budget-exhausted error", () => {
    const ctx = createRunContext({
      currentError: { message: "duplicate tool call blocked", category: "budget-exhausted" },
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });
});
