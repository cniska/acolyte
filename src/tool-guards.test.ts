import { describe, expect, test } from "bun:test";
import { createSessionContext, recordCall, resetCycleStepCount, runGuards } from "./tool-guards";

describe("guard events", () => {
  test("emits GuardEvent payload when a guard blocks", () => {
    const events: Array<{ guardId: string; toolName: string; action: string; detail?: string }> = [];
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

describe("no-delete-rewrite guard", () => {
  test("allows delete when path was NOT read", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).not.toThrow();
  });

  test("blocks delete when path WAS read", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Cannot delete.*src\/foo\.ts/,
    );
  });

  test("normalizes ./ prefixed paths", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "./src/foo.ts" }] });
    expect(() => runGuards({ toolName: "delete-file", args: { path: "src/foo.ts" }, session })).toThrow(
      /Cannot delete/,
    );
  });

  test("is no-op for other tools", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "edit-file", args: { path: "src/foo.ts" }, session })).not.toThrow();
  });

  test("is task-scoped: read in prior task does not block delete in new task", () => {
    const session = createSessionContext("task_a");
    recordCall(session, "read-file", { paths: [{ path: "src/foo.ts" }] });
    session.taskId = "task_b";
    expect(() => runGuards({ toolName: "delete-file", args: { paths: ["src/foo.ts"] }, session })).not.toThrow();
  });

  test("does not block delete for a different path with same basename", () => {
    const session = createSessionContext();
    recordCall(session, "read-file", { paths: [{ path: "docs/config.ts" }] });
    expect(() => runGuards({ toolName: "delete-file", args: { paths: ["src/config.ts"] }, session })).not.toThrow();
  });
});

describe("redundant-verify guard", () => {
  test("allows first verify run", () => {
    const session = createSessionContext();
    session.mode = "verify";
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("blocks duplicate verify when no writes happened since last verify", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    expect(() => runGuards({ toolName: "run-command", args: { command: "bun run verify" }, session })).toThrow(
      /Duplicate run-command call detected|verify already ran this turn/,
    );
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
