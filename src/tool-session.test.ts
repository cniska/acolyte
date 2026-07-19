import { describe, expect, test } from "bun:test";
import { hashResultValue } from "./tool-execution";
import { checkStepBudget, createSessionContext, recordCall } from "./tool-session";

describe("step budget", () => {
  test("blocks when the per-request call count reaches the limit", () => {
    const session = createSessionContext();
    session.maxToolCallsPerRequest = 3;
    for (let i = 0; i < 3; i++) recordCall(session, "file-read", {});
    expect(checkStepBudget(session)).toContain("Request tool-call limit reached (3)");
  });

  test("passes while below the limit", () => {
    const session = createSessionContext();
    session.maxToolCallsPerRequest = 10;
    for (let i = 0; i < 4; i++) recordCall(session, "file-read", {});
    expect(checkStepBudget(session)).toBeUndefined();
  });

  test("resets per request because the counter is the per-request call log", () => {
    const session = createSessionContext();
    session.maxToolCallsPerRequest = 2;
    recordCall(session, "file-read", {});
    recordCall(session, "file-read", {});
    expect(checkStepBudget(session)).toBeDefined();
    // A fresh request builds a fresh SessionContext, so the count starts at zero again.
    expect(checkStepBudget(createSessionContext())).toBeUndefined();
  });

  test("exhaustion message carries no imperative tail", () => {
    const session = createSessionContext();
    session.maxToolCallsPerRequest = 1;
    recordCall(session, "file-read", {});
    const message = checkStepBudget(session) ?? "";
    expect(message).toBe("Request tool-call limit reached (1).");
    expect(message.toLowerCase()).not.toContain("commit");
    expect(message.toLowerCase()).not.toContain("wrap up");
  });
});

describe("recordCall", () => {
  test("appends to callLog with active task id", () => {
    const session = createSessionContext("task_1");
    expect(session.callLog).toHaveLength(0);
    recordCall(session, "file-read", { paths: [{ path: "a.ts" }] });
    recordCall(session, "file-edit", { path: "a.ts" });
    expect(session.callLog).toHaveLength(2);
    expect(session.callLog[0]?.toolName).toBe("file-read");
    expect(session.callLog[0]?.taskId).toBe("task_1");
    expect(session.callLog[1]?.toolName).toBe("file-edit");
    expect(session.callLog[1]?.taskId).toBe("task_1");
  });

  test("records optional exit code metadata", () => {
    const session = createSessionContext("task_1");
    recordCall(session, "test-run", { files: ["a.test.ts"] }, undefined, "succeeded", { exitCode: 1 });
    expect(session.callLog[0]).toMatchObject({ toolName: "test-run", exitCode: 1, status: "succeeded" });
  });
});

describe("hashResultValue", () => {
  test("returns consistent hash for same input", () => {
    expect(hashResultValue({ a: 1 })).toBe(hashResultValue({ a: 1 }));
  });

  test("returns different hash for different input", () => {
    expect(hashResultValue({ a: 1 })).not.toBe(hashResultValue({ a: 2 }));
  });

  test("returns undefined for null/undefined", () => {
    expect(hashResultValue(null)).toBeUndefined();
    expect(hashResultValue(undefined)).toBeUndefined();
  });

  test("returns undefined for very large values", () => {
    expect(hashResultValue("x".repeat(11_000))).toBeUndefined();
  });
});
