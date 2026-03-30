import { describe, expect, test } from "bun:test";
import { hashResultValue } from "./tool-execution";
import { createSessionContext, recordCall, resetCycleStepCount, runGuards } from "./tool-guards";

describe("step-budget guard", () => {
  test("blocks when cycle step count reaches cycle limit", () => {
    const session = createSessionContext();
    session.flags.cycleStepLimit = 2;
    session.flags.cycleStepCount = 2;
    expect(() => runGuards({ toolName: "file-read", args: {}, session })).toThrow(/Cycle step budget exhausted/);
  });

  test("blocks when total call log reaches total limit", () => {
    const session = createSessionContext();
    session.flags.totalStepLimit = 3;
    for (let i = 0; i < 3; i++) {
      recordCall(session, "file-read", {});
    }
    expect(() => runGuards({ toolName: "file-read", args: {}, session })).toThrow(/Total step budget exhausted/);
  });

  test("increments cycle step count on each allowed call", () => {
    const session = createSessionContext();
    session.flags.cycleStepLimit = 10;
    session.flags.cycleStepCount = 0;
    runGuards({ toolName: "file-read", args: { paths: [{ path: "a.ts" }] }, session });
    expect(session.flags.cycleStepCount).toBe(1);
  });

  test("resetCycleStepCount resets counter and optionally sets limit", () => {
    const session = createSessionContext();
    session.flags.cycleStepCount = 42;
    session.flags.cycleStepLimit = 80;
    resetCycleStepCount(session, 30);
    expect(session.flags.cycleStepCount).toBe(0);
    expect(session.flags.cycleStepLimit).toBe(30);
  });

  test("resetCycleStepCount without limit only resets counter", () => {
    const session = createSessionContext();
    session.flags.cycleStepCount = 10;
    session.flags.cycleStepLimit = 80;
    resetCycleStepCount(session);
    expect(session.flags.cycleStepCount).toBe(0);
    expect(session.flags.cycleStepLimit).toBe(80);
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
