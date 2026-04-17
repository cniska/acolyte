import { describe, expect, test } from "bun:test";
import { hashResultValue } from "./tool-execution";
import {
  checkStepBudget,
  createSessionContext,
  preWriteDiscoveryCount,
  recordCall,
  resetTurnStepCount,
} from "./tool-session";

describe("step budget", () => {
  test("blocks when turn step count reaches turn limit", () => {
    const session = createSessionContext();
    session.flags.turnStepLimit = 2;
    session.flags.turnStepCount = 2;
    expect(checkStepBudget(session)).toContain("Turn step budget exhausted");
  });

  test("blocks when total call log reaches total limit", () => {
    const session = createSessionContext();
    session.flags.totalStepLimit = 3;
    for (let i = 0; i < 3; i++) {
      recordCall(session, "file-read", {});
    }
    expect(checkStepBudget(session)).toContain("Total step budget exhausted");
  });

  test("increments turn step count on each allowed call", () => {
    const session = createSessionContext();
    session.flags.turnStepLimit = 10;
    session.flags.turnStepCount = 0;
    expect(checkStepBudget(session)).toBeUndefined();
    expect(session.flags.turnStepCount).toBe(1);
  });

  test("resetTurnStepCount resets counter and optionally sets limit", () => {
    const session = createSessionContext();
    session.flags.turnStepCount = 42;
    session.flags.turnStepLimit = 80;
    resetTurnStepCount(session, 30);
    expect(session.flags.turnStepCount).toBe(0);
    expect(session.flags.turnStepLimit).toBe(30);
  });

  test("resetTurnStepCount without limit only resets counter", () => {
    const session = createSessionContext();
    session.flags.turnStepCount = 10;
    session.flags.turnStepLimit = 80;
    resetTurnStepCount(session);
    expect(session.flags.turnStepCount).toBe(0);
    expect(session.flags.turnStepLimit).toBe(80);
  });
});

describe("token ceiling", () => {
  test("blocks when total tokens exceed limit", () => {
    const session = createSessionContext();
    session.flags.totalTokenLimit = 1000;
    session.flags.totalTokens = () => 1500;
    expect(checkStepBudget(session)).toContain("Token budget exhausted");
  });

  test("blocks when total tokens equal limit", () => {
    const session = createSessionContext();
    session.flags.totalTokenLimit = 1000;
    session.flags.totalTokens = () => 1000;
    expect(checkStepBudget(session)).toContain("Token budget exhausted");
  });

  test("allows when under limit", () => {
    const session = createSessionContext();
    session.flags.totalTokenLimit = 1000;
    session.flags.totalTokens = () => 500;
    expect(checkStepBudget(session)).toBeUndefined();
  });

  test("skips when not configured", () => {
    const session = createSessionContext();
    expect(checkStepBudget(session)).toBeUndefined();
  });
});

describe("consecutive failures", () => {
  test("blocks tool after 3 consecutive failures", () => {
    const session = createSessionContext();
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    expect(checkStepBudget(session, "file-edit")).toContain('Tool "file-edit" failed 3 times consecutively');
  });

  test("allows with fewer failures", () => {
    const session = createSessionContext();
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    expect(checkStepBudget(session, "file-edit")).toBeUndefined();
  });

  test("resets on success", () => {
    const session = createSessionContext();
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "succeeded");
    expect(checkStepBudget(session, "file-edit")).toBeUndefined();
  });

  test("tracks independently per tool", () => {
    const session = createSessionContext();
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "shell-exec", {}, undefined, "failed");
    expect(checkStepBudget(session, "file-edit")).toContain("failed 3 times");
    expect(checkStepBudget(session, "shell-exec")).toBeUndefined();
  });

  test("skips when no toolId provided", () => {
    const session = createSessionContext();
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    recordCall(session, "file-edit", {}, undefined, "failed");
    expect(checkStepBudget(session)).toBeUndefined();
  });
});

describe("pre-write discovery budget", () => {
  const writeTools = new Set(["file-edit", "file-create"]);
  const discoveryTools = new Set(["file-read", "file-search", "file-find"]);

  test("counts consecutive discovery calls since last write", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    recordCall(session, "file-search", {});
    recordCall(session, "file-read", {});
    recordCall(session, "file-edit", {});
    recordCall(session, "file-search", {});
    recordCall(session, "file-find", {});
    expect(preWriteDiscoveryCount(session)).toBe(2);
  });

  test("returns total discovery count when no writes have happened", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    recordCall(session, "file-search", {});
    recordCall(session, "file-read", {});
    recordCall(session, "file-find", {});
    expect(preWriteDiscoveryCount(session)).toBe(3);
  });

  test("ignores non-discovery, non-write calls when counting", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    recordCall(session, "file-read", {});
    recordCall(session, "web-fetch", {});
    recordCall(session, "file-search", {});
    expect(preWriteDiscoveryCount(session)).toBe(2);
  });

  test("blocks discovery tool when limit reached", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    session.flags.preWriteDiscoveryLimit = 3;
    for (let i = 0; i < 3; i++) recordCall(session, "file-search", {});
    expect(checkStepBudget(session, "file-read")).toContain("discovery");
  });

  test("does not block write tool when discovery limit reached", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    session.flags.preWriteDiscoveryLimit = 3;
    for (let i = 0; i < 3; i++) recordCall(session, "file-search", {});
    expect(checkStepBudget(session, "file-edit")).toBeUndefined();
  });

  test("allows discovery after a write resets the count", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    session.flags.preWriteDiscoveryLimit = 3;
    for (let i = 0; i < 3; i++) recordCall(session, "file-search", {});
    recordCall(session, "file-edit", {});
    expect(checkStepBudget(session, "file-read")).toBeUndefined();
  });

  test("is inactive when no limit is set", () => {
    const session = createSessionContext(undefined, writeTools, discoveryTools);
    for (let i = 0; i < 20; i++) recordCall(session, "file-search", {});
    expect(checkStepBudget(session, "file-read")).toBeUndefined();
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
