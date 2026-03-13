import { describe, expect, test } from "bun:test";
import { hashResultValue } from "./tool-execution";
import { createSessionContext, recordCall, resetCycleStepCount, runGuards } from "./tool-guards";

describe("guard events", () => {
  test("emits GuardEvent payload when a guard blocks", () => {
    const events: Array<{
      guardId: string;
      toolName: string;
      action: string;
      detail?: string;
      feedback?: { summary: string; details?: string; instruction?: string };
    }> = [];
    const session = createSessionContext();
    session.onGuard = (event) => events.push(event);

    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Duplicate read-file call detected|Already read "src\/foo.ts" this turn/,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      guardId: "duplicate-call",
      toolName: "read-file",
      action: "blocked",
      detail: "duplicate-call",
      feedback: {
        summary: "The previous read-file call already used these arguments.",
        instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
      },
    });
  });
});
describe("step-budget guard", () => {
  test("blocks when cycle step count reaches cycle limit", () => {
    const session = createSessionContext();
    session.flags.cycleStepLimit = 2;
    session.flags.cycleStepCount = 2;
    expect(() => runGuards({ toolName: "read-file", args: {}, session })).toThrow(/Cycle step budget exhausted/);
  });

  test("blocks when total call log reaches total limit", () => {
    const session = createSessionContext();
    session.flags.totalStepLimit = 3;
    for (let i = 0; i < 3; i += 1) {
      recordCall(session, "read-file", {});
    }
    expect(() => runGuards({ toolName: "read-file", args: {}, session })).toThrow(/Total step budget exhausted/);
  });

  test("increments cycle step count on each allowed call", () => {
    const session = createSessionContext();
    session.flags.cycleStepLimit = 10;
    session.flags.cycleStepCount = 0;
    runGuards({ toolName: "read-file", args: { paths: [{ path: "a.ts" }] }, session });
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

describe("redundant-verify guard", () => {
  test("allows first verify run", () => {
    const session = createSessionContext();
    session.mode = "verify";
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("blocks duplicate verify-mode command when no writes happened since previous run", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "npm test" });
    expect(() => runGuards({ toolName: "run-command", args: { command: "npm test" }, session })).toThrow(
      /Duplicate run-command call detected|verify already ran this turn/,
    );
  });

  test("allows a different command in verify mode", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "npm test" });
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("allows verify rerun after a write", () => {
    const session = createSessionContext();
    session.mode = "verify";
    session.writeTools = new Set(["edit-file", "run-command"]);
    recordCall(session, "run-command", { command: "bun run verify" });
    recordCall(session, "edit-file", { path: "src/foo.ts" });
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("does not block outside verify mode", () => {
    const session = createSessionContext();
    session.mode = "work";
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
  });
});

describe("file-churn guard", () => {
  test("blocks immediate duplicate read-file call on same path and range", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Duplicate read-file call detected|Already read "src\/foo.ts" this turn/,
    );
  });

  test("blocks read-only churn even when churned path is part of batched read", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    }

    expect(() =>
      runGuards({
        toolName: "read-file",
        args: { paths: [{ path: "src/foo.ts" }, { path: "src/other.ts" }] },
        session,
      }),
    ).toThrow(/has been read 4 times without edits/);
  });

  test("allows duplicate single-file read after batched read", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", {
      paths: [{ path: "src/chat-commands.ts" }, { path: "src/chat-commands.test.ts" }],
    });
    expect(() =>
      runGuards({ toolName: "read-file", args: { paths: [{ path: "src/chat-commands.ts" }] }, session }),
    ).not.toThrow();
  });
  test("allows a second read with a different range before any edit", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts", start: 1, end: 40 }] });
    expect(() =>
      runGuards({ toolName: "read-file", args: { paths: [{ path: "src/foo.ts", start: 41, end: 80 }] }, session }),
    ).not.toThrow();
  });

  test("blocks repeated read/edit churn on same path before verify", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    for (let i = 0; i < 6; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "edit-file", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Repeated read\/edit loop detected/,
    );
  });

  test("still blocks heavy churn even when verify already ran", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    session.mode = "work";
    for (let i = 0; i < 8; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "edit-file", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Duplicate edit-file call detected|Repeated read\/edit loop detected/,
    );
  });

  test("still blocks immediate duplicate edit calls after verify", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    session.mode = "work";
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "edit-file", { path: "src/foo.ts" });
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "edit-file", { path: "src/foo.ts" });
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Duplicate edit-file call detected/,
    );
  });

  test("does not block when churn is spread across files", () => {
    const session = createSessionContext();
    for (let i = 0; i < 6; i += 1) {
      recordCall(session, "read-file", { paths: [{ path: "src/a.ts" }] });
      recordCall(session, "edit-file", { path: "src/a.ts" });
      recordCall(session, "read-file", { paths: [{ path: "src/b.ts" }] });
      recordCall(session, "edit-file", { path: "src/b.ts" });
    }
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "src/c.ts" }] }, session })).not.toThrow();
  });
});

describe("redundant-search guard", () => {
  test("blocks duplicate search in same scope", () => {
    const session = createSessionContext();
    recordCall(session, "search-files", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "search-files", args: { patterns: ["tool", "agent"] }, session })).toThrow(
      /Duplicate search-files call detected/,
    );
  });

  test("blocks narrower search when prior search already covered patterns", () => {
    const session = createSessionContext();
    recordCall(session, "search-files", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "search-files", args: { patterns: ["agent"] }, session })).toThrow(
      /Redundant narrower search-files call detected/,
    );
  });

  test("does not treat regex-boundary variant as identical duplicate", () => {
    const session = createSessionContext();
    recordCall(session, "search-files", { patterns: ["\\bagent\\b", "\\btool\\b"] });
    expect(() => runGuards({ toolName: "search-files", args: { patterns: ["agent", "tool"] }, session })).not.toThrow();
  });

  test("does not block narrower search across different scope", () => {
    const session = createSessionContext();
    recordCall(session, "search-files", { patterns: ["agent", "tool"] });
    expect(() =>
      runGuards({ toolName: "search-files", args: { patterns: ["agent", "memory"], paths: ["AGENTS.md"] }, session }),
    ).not.toThrow();
  });

  test("blocks redundant scope narrowing after workspace search", () => {
    const session = createSessionContext();
    recordCall(session, "search-files", { patterns: ["agent", "tool"] });
    expect(() =>
      runGuards({ toolName: "search-files", args: { patterns: ["agent"], paths: ["AGENTS.md"] }, session }),
    ).toThrow(/Redundant scoped search-files call detected/);
  });

  test("blocks repeated search-only churn without reads/writes", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "search-files", { pattern: `query-${i}` });
    }
    expect(() => runGuards({ toolName: "search-files", args: { pattern: "query-5" }, session })).toThrow(
      /Repeated search-files loop detected/,
    );
  });

  test("does not block when read-file has already been used", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "search-files", { pattern: `query-${i}` });
    }
    recordCall(session, "read-file", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "search-files", args: { pattern: "query-5" }, session })).not.toThrow();
  });

  test("does not block when a write tool has already been used", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "search-files", { pattern: `query-${i}` });
    }
    recordCall(session, "edit-file", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "search-files", args: { pattern: "query-5" }, session })).not.toThrow();
  });
});

describe("redundant-find guard", () => {
  test("blocks duplicate find in same scope", () => {
    const session = createSessionContext();
    recordCall(session, "find-files", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["tool", "agent"] }, session })).toThrow(
      /Duplicate find-files call detected/,
    );
  });

  test("blocks narrower find when prior find already covered patterns", () => {
    const session = createSessionContext();
    recordCall(session, "find-files", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["agent"] }, session })).toThrow(
      /Redundant narrower find-files call detected/,
    );
  });

  test("blocks narrower find after universal find", () => {
    const session = createSessionContext();
    recordCall(session, "find-files", { patterns: ["**/*"] });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["**/*agent*"] }, session })).toThrow(
      /Prior universal find already covers this scope/,
    );
  });

  test("blocks repeated find-only churn without reads/writes", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "find-files", { patterns: [`query-${i}`] });
    }
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["query-5"] }, session })).toThrow(
      /Repeated find-files loop detected/,
    );
  });

  test("does not block when read-file has already been used", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "find-files", { patterns: [`query-${i}`] });
    }
    recordCall(session, "read-file", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["query-5"] }, session })).not.toThrow();
  });

  test("does not block when a write tool has already been used", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    for (let i = 0; i < 4; i += 1) {
      recordCall(session, "find-files", { patterns: [`query-${i}`] });
    }
    recordCall(session, "edit-file", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["query-5"] }, session })).not.toThrow();
  });
});

describe("recordCall", () => {
  test("appends to callLog with active task id", () => {
    const session = createSessionContext("task_1");
    expect(session.callLog).toHaveLength(0);
    recordCall(session, "read-file", { paths: [{ path: "a.ts" }] });
    recordCall(session, "edit-file", { path: "a.ts" });
    expect(session.callLog).toHaveLength(2);
    expect(session.callLog[0]?.toolName).toBe("read-file");
    expect(session.callLog[0]?.taskId).toBe("task_1");
    expect(session.callLog[1]?.toolName).toBe("edit-file");
    expect(session.callLog[1]?.taskId).toBe("task_1");
  });
});

describe("duplicate-call guard", () => {
  test("blocks immediate duplicate tool calls with same args", () => {
    const session = createSessionContext();
    recordCall(session, "git-status", {});
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).toThrow(
      /Duplicate git-status call detected/,
    );
  });

  test("blocks duplicate with only read-only tools in between", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file", "run-command"]);
    recordCall(session, "git-status", {});
    recordCall(session, "read-file", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).toThrow(
      /Duplicate git-status call detected/,
    );
  });

  test("allows duplicate after a write tool in between", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file", "run-command"]);
    recordCall(session, "git-status", {});
    recordCall(session, "edit-file", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).not.toThrow();
  });

  test("treats whitespace-only arg changes as duplicates", () => {
    const session = createSessionContext();
    recordCall(session, "run-command", { command: "bun run verify" });
    expect(() => runGuards({ toolName: "run-command", args: { command: "  bun run verify  " }, session })).toThrow(
      /Duplicate run-command call detected/,
    );
  });

  test("is task-scoped: duplicate in prior task does not block current task", () => {
    const session = createSessionContext("task_a");
    recordCall(session, "git-status", {});
    session.taskId = "task_b";
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).not.toThrow();
  });
});

describe("ping-pong guard", () => {
  test("blocks alternating tool calls with same args", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    // A -> edit -> B -> A -> edit -> B -> (attempting A again)
    // The ping-pong guard sees the A/B alternation pattern
    recordCall(session, "read-file", { paths: [{ path: "a.ts" }] });
    recordCall(session, "edit-file", { path: "x.ts" });
    recordCall(session, "search-files", { patterns: ["foo"] });
    recordCall(session, "read-file", { paths: [{ path: "a.ts" }] });
    recordCall(session, "edit-file", { path: "y.ts" });
    recordCall(session, "search-files", { patterns: ["foo"] });
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "a.ts" }] }, session })).toThrow(
      /Ping-pong loop detected/,
    );
  });

  test("does not block when args differ", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    recordCall(session, "read-file", { paths: [{ path: "a.ts" }] });
    recordCall(session, "edit-file", { path: "x.ts" });
    recordCall(session, "search-files", { patterns: ["foo"] });
    recordCall(session, "read-file", { paths: [{ path: "b.ts" }] });
    recordCall(session, "edit-file", { path: "y.ts" });
    recordCall(session, "search-files", { patterns: ["foo"] });
    expect(() => runGuards({ toolName: "read-file", args: { paths: [{ path: "a.ts" }] }, session })).not.toThrow();
  });

  test("does not block with fewer than 2 alternations", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    // Only 1 alternation: A -> B -> (attempting A) — not enough
    recordCall(session, "search-files", { patterns: ["foo"] });
    recordCall(session, "edit-file", { path: "a.ts" });
    recordCall(session, "find-files", { patterns: ["bar"] });
    expect(() => runGuards({ toolName: "search-files", args: { patterns: ["foo"] }, session })).not.toThrow();
  });

  test("does not trigger when last call is same tool (not alternating)", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    // Last call is find-files, proposed is also find-files — same tool, not alternating
    recordCall(session, "search-files", { patterns: ["foo"] });
    recordCall(session, "edit-file", { path: "a.ts" });
    recordCall(session, "find-files", { patterns: ["bar"] });
    recordCall(session, "edit-file", { path: "b.ts" });
    recordCall(session, "find-files", { patterns: ["baz"] });
    expect(() => runGuards({ toolName: "find-files", args: { patterns: ["qux"] }, session })).not.toThrow();
  });
});

describe("stale-result guard", () => {
  test("blocks when same tool+args returns same result 3 times", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    const args = { patterns: ["foo"] };
    const hash = hashResultValue({ matches: ["a.ts:1"] });
    // Interleave unique write calls to avoid duplicate-call and ping-pong guards
    recordCall(session, "search-files", args, hash);
    recordCall(session, "edit-file", { path: "a.ts" });
    recordCall(session, "search-files", args, hash);
    recordCall(session, "edit-file", { path: "b.ts" });
    recordCall(session, "search-files", args, hash);
    recordCall(session, "edit-file", { path: "c.ts" });
    expect(() => runGuards({ toolName: "search-files", args, session })).toThrow(
      /has returned the same result 3 times/,
    );
  });

  test("does not block when results differ", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    const args = { patterns: ["foo"] };
    recordCall(session, "search-files", args, hashResultValue({ matches: ["a.ts:1"] }));
    recordCall(session, "edit-file", { path: "a.ts" });
    recordCall(session, "search-files", args, hashResultValue({ matches: ["b.ts:2"] }));
    recordCall(session, "edit-file", { path: "b.ts" });
    recordCall(session, "search-files", args, hashResultValue({ matches: ["a.ts:1"] }));
    recordCall(session, "edit-file", { path: "c.ts" });
    expect(() => runGuards({ toolName: "search-files", args, session })).not.toThrow();
  });

  test("does not block write tools", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    const hash = hashResultValue("ok");
    // Different args for each call to avoid duplicate-call guard
    recordCall(session, "edit-file", { path: "a.ts" }, hash);
    recordCall(session, "edit-file", { path: "b.ts" }, hash);
    recordCall(session, "edit-file", { path: "c.ts" }, hash);
    expect(() => runGuards({ toolName: "edit-file", args: { path: "d.ts" }, session })).not.toThrow();
  });

  test("does not block when fewer than threshold", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file"]);
    const args = { patterns: ["foo"] };
    const hash = hashResultValue({ matches: ["a.ts:1"] });
    recordCall(session, "search-files", args, hash);
    recordCall(session, "edit-file", { path: "a.ts" });
    recordCall(session, "search-files", args, hash);
    recordCall(session, "edit-file", { path: "b.ts" });
    expect(() => runGuards({ toolName: "search-files", args, session })).not.toThrow();
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

describe("circuit-breaker guard", () => {
  test("blocks after 5 consecutive guard blocks", () => {
    const session = createSessionContext();
    session.flags.consecutiveBlocks = 5;
    expect(() => runGuards({ toolName: "read-file", args: {}, session })).toThrow(
      /consecutive tool calls have been blocked/,
    );
  });

  test("does not block below threshold", () => {
    const session = createSessionContext();
    session.flags.consecutiveBlocks = 4;
    expect(() => runGuards({ toolName: "read-file", args: {}, session })).not.toThrow();
  });

  test("resets counter when guards pass", () => {
    const session = createSessionContext();
    session.flags.consecutiveBlocks = 3;
    runGuards({ toolName: "read-file", args: {}, session });
    expect(session.flags.consecutiveBlocks).toBe(0);
  });

  test("uses configured guard block limit", () => {
    const session = createSessionContext();
    session.flags.consecutiveGuardBlockLimit = 2;
    session.flags.consecutiveBlocks = 2;
    expect(() => runGuards({ toolName: "read-file", args: {}, session })).toThrow(
      /consecutive tool calls have been blocked/,
    );
  });
});
