import { describe, expect, test } from "bun:test";
import { hashResultValue } from "./tool-execution";
import { createSessionContext, type GuardEvent, recordCall, resetCycleStepCount, runGuards } from "./tool-guards";

describe("guard events", () => {
  test("emits GuardEvent payload when a guard blocks", () => {
    const events: GuardEvent[] = [];
    const session = createSessionContext();
    session.onGuard = (event) => events.push(event);

    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Duplicate file-read call detected|Already read "src\/foo.ts" this turn/,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      guardId: "duplicate-call",
      toolName: "file-read",
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

  test("does not consume cycle step budget when a later guard blocks", () => {
    const session = createSessionContext();
    session.flags.cycleStepLimit = 10;
    session.flags.cycleStepCount = 0;
    recordCall(session, "file-read", { paths: [{ path: "a.ts" }] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "a.ts" }] }, session })).toThrow(
      /Duplicate file-read call detected/,
    );
    expect(session.flags.cycleStepCount).toBe(0);
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

describe("shell-run duplicate guard", () => {
  test("blocks duplicate shell-run commands", () => {
    const events: GuardEvent[] = [];
    const session = createSessionContext();
    session.onGuard = (event) => events.push(event);
    recordCall(session, "shell-run", { command: "bun run verify" });

    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun run verify" }, session })).toThrow(
      /Duplicate shell-run call detected/,
    );
    expect(events.some((event) => event.guardId === "duplicate-call")).toBe(true);
  });

  test("allows first shell-run call", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("blocks duplicate shell-run command when no writes happened since previous run", () => {
    const session = createSessionContext();
    recordCall(session, "shell-run", { command: "npm test" });
    expect(() => runGuards({ toolName: "shell-run", args: { command: "npm test" }, session })).toThrow(
      /Duplicate shell-run call detected/,
    );
  });

  test("allows a different shell-run command", () => {
    const session = createSessionContext();
    recordCall(session, "shell-run", { command: "npm test" });
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun run verify" }, session })).not.toThrow();
  });

  test("allows shell-run rerun after a write", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit", "shell-run"]);
    recordCall(session, "shell-run", { command: "bun run verify" });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun run verify" }, session })).not.toThrow();
  });
});

describe("file-churn guard", () => {
  test("blocks immediate duplicate file-read call on same path and range", () => {
    const session = createSessionContext();
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /Duplicate file-read call detected|Already read "src\/foo.ts" this turn/,
    );
  });

  test("blocks read-only churn even when churned path is part of batched read", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    }

    expect(() =>
      runGuards({
        toolName: "file-read",
        args: { paths: [{ path: "src/foo.ts" }, { path: "src/other.ts" }] },
        session,
      }),
    ).toThrow(/has been read 4 times without edits/);
  });

  test("allows duplicate single-file read after batched read", () => {
    const session = createSessionContext();
    recordCall(session, "file-read", {
      paths: [{ path: "src/chat-commands.ts" }, { path: "src/chat-commands.test.ts" }],
    });
    expect(() =>
      runGuards({ toolName: "file-read", args: { paths: [{ path: "src/chat-commands.ts" }] }, session }),
    ).not.toThrow();
  });
  test("allows first re-read of an edited file for follow-up edits", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    expect(() =>
      runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session }),
    ).not.toThrow();
  });

  test("blocks re-read of an edited file when already re-read since last edit", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    session.cache = {
      isCacheable: () => true,
      get: () => undefined,
      set: () => {},
      populateSubEntries: () => {},
      invalidateForWrite: () => {},
      clear: () => {},
      stats: () => ({ hits: 0, misses: 0, invalidations: 0, evictions: 0, size: 0 }),
    };
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /already re-read/,
    );
  });

  test("allows rereading an edited file after an edit", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    expect(() =>
      runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session }),
    ).not.toThrow();
  });

  test("allows reading a different file after an edit", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    expect(() =>
      runGuards({ toolName: "file-read", args: { paths: [{ path: "src/bar.ts" }] }, session }),
    ).not.toThrow();
  });

  test("blocks rereading the same path before heavy read/edit churn can continue", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    for (let i = 0; i < 6; i++) {
      recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "file-edit", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session })).toThrow(
      /read\/edit loop/,
    );
  });

  test("still blocks heavy churn even when a verify command already ran", () => {
    const session = createSessionContext();
    recordCall(session, "shell-run", { command: "bun run verify" });
    for (let i = 0; i < 8; i++) {
      recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
      recordCall(session, "file-edit", { path: "src/foo.ts" });
    }
    expect(() => runGuards({ toolName: "file-edit", args: { path: "src/foo.ts" }, session })).toThrow(
      /Duplicate file-edit call detected|Repeated read\/edit loop detected/,
    );
  });

  test("still blocks immediate duplicate edit calls after a verify command", () => {
    const session = createSessionContext();
    recordCall(session, "shell-run", { command: "bun run verify" });
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" });
    expect(() => runGuards({ toolName: "file-edit", args: { path: "src/foo.ts" }, session })).toThrow(
      /Duplicate file-edit call detected/,
    );
  });

  test("does not block when churn is spread across files", () => {
    const session = createSessionContext();
    for (let i = 0; i < 6; i++) {
      recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
      recordCall(session, "file-edit", { path: "src/a.ts" });
      recordCall(session, "file-read", { paths: [{ path: "src/b.ts" }] });
      recordCall(session, "file-edit", { path: "src/b.ts" });
    }
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "src/c.ts" }] }, session })).not.toThrow();
  });
});

describe("redundant-search guard", () => {
  test("blocks duplicate search in same scope", () => {
    const session = createSessionContext();
    recordCall(session, "file-search", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "file-search", args: { patterns: ["tool", "agent"] }, session })).toThrow(
      /Duplicate file-search call detected/,
    );
  });

  test("blocks narrower search when prior search already covered patterns", () => {
    const session = createSessionContext();
    recordCall(session, "file-search", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "file-search", args: { patterns: ["agent"] }, session })).toThrow(
      /Redundant narrower file-search call detected/,
    );
  });

  test("does not treat regex-boundary variant as identical duplicate", () => {
    const session = createSessionContext();
    recordCall(session, "file-search", { patterns: ["\\bagent\\b", "\\btool\\b"] });
    expect(() => runGuards({ toolName: "file-search", args: { patterns: ["agent", "tool"] }, session })).not.toThrow();
  });

  test("does not block narrower search across different scope", () => {
    const session = createSessionContext();
    recordCall(session, "file-search", { patterns: ["agent", "tool"] });
    expect(() =>
      runGuards({ toolName: "file-search", args: { patterns: ["agent", "memory"], paths: ["AGENTS.md"] }, session }),
    ).not.toThrow();
  });

  test("blocks redundant scope narrowing after workspace search", () => {
    const session = createSessionContext();
    recordCall(session, "file-search", { patterns: ["agent", "tool"] });
    expect(() =>
      runGuards({ toolName: "file-search", args: { patterns: ["agent"], paths: ["AGENTS.md"] }, session }),
    ).toThrow(/Redundant scoped file-search call detected/);
  });

  test("blocks repeated search-only churn without reads/writes", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-search", { pattern: `query-${i}` });
    }
    expect(() => runGuards({ toolName: "file-search", args: { pattern: "query-5" }, session })).toThrow(
      /Repeated file-search loop detected/,
    );
  });

  test("does not block when file-read has already been used", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-search", { pattern: `query-${i}` });
    }
    recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "file-search", args: { pattern: "query-5" }, session })).not.toThrow();
  });

  test("does not block when a write tool has already been used", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-search", { pattern: `query-${i}` });
    }
    recordCall(session, "file-edit", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "file-search", args: { pattern: "query-5" }, session })).not.toThrow();
  });

  test("blocks same-file search immediately after a direct whole-file read", () => {
    const session = createSessionContext();
    recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
    expect(() =>
      runGuards({
        toolName: "file-search",
        args: { patterns: ["return undefined;"], paths: ["src/a.ts"] },
        session,
      }),
    ).toThrow(/already read directly in full/i);
  });

  test("blocks same-file search after reading that file", () => {
    const session = createSessionContext();
    recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
    expect(() =>
      runGuards({
        toolName: "file-search",
        args: { patterns: ["return undefined;"], paths: ["src/a.ts"] },
        session,
      }),
    ).toThrow(/already read directly in full/i);
  });
});

describe("redundant-find guard", () => {
  test("blocks duplicate find in same scope", () => {
    const session = createSessionContext();
    recordCall(session, "file-find", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["tool", "agent"] }, session })).toThrow(
      /Duplicate file-find call detected/,
    );
  });

  test("blocks narrower find when prior find already covered patterns", () => {
    const session = createSessionContext();
    recordCall(session, "file-find", { patterns: ["agent", "tool"] });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["agent"] }, session })).toThrow(
      /Redundant narrower file-find call detected/,
    );
  });

  test("blocks narrower find after universal find", () => {
    const session = createSessionContext();
    recordCall(session, "file-find", { patterns: ["**/*"] });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["**/*agent*"] }, session })).toThrow(
      /Prior universal find already covers this scope/,
    );
  });

  test("blocks repeated find-only churn without reads/writes", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-find", { patterns: [`query-${i}`] });
    }
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["query-5"] }, session })).toThrow(
      /Repeated file-find loop detected/,
    );
  });

  test("does not block when file-read has already been used", () => {
    const session = createSessionContext();
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-find", { patterns: [`query-${i}`] });
    }
    recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["query-5"] }, session })).not.toThrow();
  });

  test("does not block when a write tool has already been used", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    for (let i = 0; i < 4; i++) {
      recordCall(session, "file-find", { patterns: [`query-${i}`] });
    }
    recordCall(session, "file-edit", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["query-5"] }, session })).not.toThrow();
  });
});

describe("post-edit-redundancy guard", () => {
  test("blocks same-file file-edit retry without new evidence after a successful edit", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts", edits: [{ find: "a", replace: "b" }] });
    expect(() =>
      runGuards({
        toolName: "file-edit",
        args: { path: "src/clamp.ts", edits: [{ find: "b", replace: "c" }] },
        session,
      }),
    ).toThrow(/already edited successfully.*no new file evidence/i);
  });

  test("allows same-file file-edit retry after rereading the file", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts", edits: [{ find: "a", replace: "b" }] });
    recordCall(session, "file-read", { paths: [{ path: "src/clamp.ts" }] });
    expect(() =>
      runGuards({
        toolName: "file-edit",
        args: { path: "src/clamp.ts", edits: [{ find: "b", replace: "c" }] },
        session,
      }),
    ).not.toThrow();
  });

  test("allows one same-file follow-up edit after review requests changes", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    session.flags.reviewAction = "request-changes";
    recordCall(session, "file-edit", { path: "src/clamp.ts", edits: [{ find: "a", replace: "b" }] });

    expect(() =>
      runGuards({
        toolName: "file-edit",
        args: { path: "src/clamp.ts", edits: [{ find: "b", replace: "c" }] },
        session,
      }),
    ).not.toThrow();
    expect(session.flags.reviewAction).toBeUndefined();
  });

  test("allows same-file edit after workspace-wide search", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts", edits: [{ find: "a", replace: "b" }] });
    recordCall(session, "file-search", { patterns: ["createId"], paths: ["."] });
    expect(() =>
      runGuards({
        toolName: "file-edit",
        args: { path: "src/clamp.ts", edits: [{ find: "b", replace: "c" }] },
        session,
      }),
    ).not.toThrow();
  });

  test("allows file-edit on a different file after a successful edit", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts", edits: [{ find: "a", replace: "b" }] });
    expect(() =>
      runGuards({
        toolName: "file-edit",
        args: { path: "src/other.ts", edits: [{ find: "x", replace: "y" }] },
        session,
      }),
    ).not.toThrow();
  });

  test("blocks file-delete on a file already edited in this turn", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit", "file-delete"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts" });
    expect(() => runGuards({ toolName: "file-delete", args: { paths: ["src/clamp.ts"] }, session })).toThrow(
      /after it was already edited in this task/i,
    );
  });

  test("allows file-delete on a different file", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit", "file-delete"]);
    recordCall(session, "file-edit", { path: "src/clamp.ts" });
    expect(() => runGuards({ toolName: "file-delete", args: { paths: ["src/old.ts"] }, session })).not.toThrow();
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
    session.writeTools = new Set(["file-edit", "shell-run"]);
    recordCall(session, "git-status", {});
    recordCall(session, "file-read", { paths: [{ path: "src/a.ts" }] });
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).toThrow(
      /Duplicate git-status call detected/,
    );
  });

  test("allows duplicate after a write tool in between", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit", "shell-run"]);
    recordCall(session, "git-status", {});
    recordCall(session, "file-edit", { path: "src/a.ts" });
    expect(() => runGuards({ toolName: "git-status", args: {}, session })).not.toThrow();
  });

  test("treats whitespace-only arg changes as duplicates", () => {
    const session = createSessionContext();
    recordCall(session, "shell-run", { command: "bun run verify" });
    expect(() => runGuards({ toolName: "shell-run", args: { command: "  bun run verify  " }, session })).toThrow(
      /Duplicate shell-run call detected/,
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
    session.writeTools = new Set(["file-edit"]);
    // A -> edit -> B -> A -> edit -> B -> (attempting A again)
    // The ping-pong guard sees the A/B alternation pattern
    recordCall(session, "file-read", { paths: [{ path: "a.ts" }] });
    recordCall(session, "file-edit", { path: "x.ts" });
    recordCall(session, "file-search", { patterns: ["foo"] });
    recordCall(session, "file-read", { paths: [{ path: "a.ts" }] });
    recordCall(session, "file-edit", { path: "y.ts" });
    recordCall(session, "file-search", { patterns: ["foo"] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "a.ts" }] }, session })).toThrow(
      /Ping-pong loop detected/,
    );
  });

  test("does not block when args differ", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-read", { paths: [{ path: "a.ts" }] });
    recordCall(session, "file-edit", { path: "x.ts" });
    recordCall(session, "file-search", { patterns: ["foo"] });
    recordCall(session, "file-read", { paths: [{ path: "b.ts" }] });
    recordCall(session, "file-edit", { path: "y.ts" });
    recordCall(session, "file-search", { patterns: ["foo"] });
    expect(() => runGuards({ toolName: "file-read", args: { paths: [{ path: "a.ts" }] }, session })).not.toThrow();
  });

  test("does not block with fewer than 2 alternations", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    // Only 1 alternation: A -> B -> (attempting A) — not enough
    recordCall(session, "file-search", { patterns: ["foo"] });
    recordCall(session, "file-edit", { path: "a.ts" });
    recordCall(session, "file-find", { patterns: ["bar"] });
    expect(() => runGuards({ toolName: "file-search", args: { patterns: ["foo"] }, session })).not.toThrow();
  });

  test("does not trigger when last call is same tool (not alternating)", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    // Last call is file-find, proposed is also file-find — same tool, not alternating
    recordCall(session, "file-search", { patterns: ["foo"] });
    recordCall(session, "file-edit", { path: "a.ts" });
    recordCall(session, "file-find", { patterns: ["bar"] });
    recordCall(session, "file-edit", { path: "b.ts" });
    recordCall(session, "file-find", { patterns: ["baz"] });
    expect(() => runGuards({ toolName: "file-find", args: { patterns: ["qux"] }, session })).not.toThrow();
  });
});

describe("stale-result guard", () => {
  test("blocks when same tool+args returns same result 3 times", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    const args = { patterns: ["foo"] };
    const hash = hashResultValue({ matches: ["a.ts:1"] });
    // Interleave unique write calls to avoid duplicate-call and ping-pong guards
    recordCall(session, "file-search", args, hash);
    recordCall(session, "file-edit", { path: "a.ts" });
    recordCall(session, "file-search", args, hash);
    recordCall(session, "file-edit", { path: "b.ts" });
    recordCall(session, "file-search", args, hash);
    recordCall(session, "file-edit", { path: "c.ts" });
    expect(() => runGuards({ toolName: "file-search", args, session })).toThrow(/has returned the same result 3 times/);
  });

  test("does not block when results differ", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    const args = { patterns: ["foo"] };
    recordCall(session, "file-search", args, hashResultValue({ matches: ["a.ts:1"] }));
    recordCall(session, "file-edit", { path: "a.ts" });
    recordCall(session, "file-search", args, hashResultValue({ matches: ["b.ts:2"] }));
    recordCall(session, "file-edit", { path: "b.ts" });
    recordCall(session, "file-search", args, hashResultValue({ matches: ["a.ts:1"] }));
    recordCall(session, "file-edit", { path: "c.ts" });
    expect(() => runGuards({ toolName: "file-search", args, session })).not.toThrow();
  });

  test("does not block write tools", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    const hash = hashResultValue("ok");
    // Different args for each call to avoid duplicate-call guard
    recordCall(session, "file-edit", { path: "a.ts" }, hash);
    recordCall(session, "file-edit", { path: "b.ts" }, hash);
    recordCall(session, "file-edit", { path: "c.ts" }, hash);
    expect(() => runGuards({ toolName: "file-edit", args: { path: "d.ts" }, session })).not.toThrow();
  });

  test("does not block when fewer than threshold", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    const args = { patterns: ["foo"] };
    const hash = hashResultValue({ matches: ["a.ts:1"] });
    recordCall(session, "file-search", args, hash);
    recordCall(session, "file-edit", { path: "a.ts" });
    recordCall(session, "file-search", args, hash);
    recordCall(session, "file-edit", { path: "b.ts" });
    expect(() => runGuards({ toolName: "file-search", args, session })).not.toThrow();
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
    expect(() => runGuards({ toolName: "file-read", args: {}, session })).toThrow(
      /consecutive tool calls have been blocked/,
    );
  });

  test("does not block below threshold", () => {
    const session = createSessionContext();
    session.flags.consecutiveBlocks = 4;
    expect(() => runGuards({ toolName: "file-read", args: {}, session })).not.toThrow();
  });

  test("resets counter when guards pass", () => {
    const session = createSessionContext();
    session.flags.consecutiveBlocks = 3;
    runGuards({ toolName: "file-read", args: {}, session });
    expect(session.flags.consecutiveBlocks).toBe(0);
  });

  test("uses configured guard block limit", () => {
    const session = createSessionContext();
    session.flags.consecutiveGuardBlockLimit = 2;
    session.flags.consecutiveBlocks = 2;
    expect(() => runGuards({ toolName: "file-read", args: {}, session })).toThrow(
      /consecutive tool calls have been blocked/,
    );
  });
});

describe("shell-bypass guard", () => {
  test("blocks git commit via shell-run", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "git commit -m 'test'" }, session })).toThrow(
      /use the dedicated git-commit tool/i,
    );
  });

  test("blocks git add via shell-run", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "git add -A" }, session })).toThrow(
      /use the dedicated git-add tool/i,
    );
  });

  test("blocks git push via shell-run", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "git push origin main" }, session })).toThrow(
      /blocked via shell-run/i,
    );
  });

  test("blocks chained git commands via shell-run", () => {
    const session = createSessionContext();
    expect(() =>
      runGuards({ toolName: "shell-run", args: { command: "git add . && git commit -m 'fix'" }, session }),
    ).toThrow(/use the dedicated/i);
  });

  test("allows non-git shell commands", () => {
    const session = createSessionContext();
    expect(() =>
      runGuards({ toolName: "shell-run", args: { command: "bun test src/foo.test.ts" }, session }),
    ).not.toThrow();
  });

  test("allows git read commands via shell-run", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "git status" }, session })).not.toThrow();
  });
});

describe("lifecycle-command guard", () => {
  test("blocks test command", () => {
    const session = createSessionContext();
    session.workspaceProfile = { testCommand: { bin: "bun", args: ["test", "$FILES"] } };
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun test" }, session })).toThrow(/test-run/);
  });

  test("blocks lint command", () => {
    const session = createSessionContext();
    session.workspaceProfile = { lintCommand: { bin: "bunx", args: ["biome", "check"] } };
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bunx biome check" }, session })).toThrow(
      /automatically/,
    );
  });

  test("allows commands when no workspace profile", () => {
    const session = createSessionContext();
    expect(() => runGuards({ toolName: "shell-run", args: { command: "bun test" }, session })).not.toThrow();
  });

  test("allows unrelated commands", () => {
    const session = createSessionContext();
    session.workspaceProfile = { testCommand: { bin: "bun", args: ["test", "$FILES"] } };
    expect(() => runGuards({ toolName: "shell-run", args: { command: "echo hello" }, session })).not.toThrow();
  });
});

describe("file-churn guard with failed edits", () => {
  test("failed edit does not block subsequent re-read", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["file-edit"]);
    recordCall(session, "file-read", { paths: [{ path: "src/foo.ts" }] });
    recordCall(session, "file-edit", { path: "src/foo.ts" }, undefined, "failed");
    expect(() =>
      runGuards({ toolName: "file-read", args: { paths: [{ path: "src/foo.ts" }] }, session }),
    ).not.toThrow();
  });
});
