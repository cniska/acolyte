import { describe, expect, test } from "bun:test";
import { createErrorStats } from "./error-handling";
import { type RunContext, scheduleMemoryCommit, shouldCommitMemory } from "./lifecycle";
import { recoveryActionForError } from "./lifecycle-evaluate";
import {
  autoVerifier,
  modeTransition,
  multiMatchEditEvaluator,
  timeoutRecovery,
  verifyFailure,
} from "./lifecycle-evaluators";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./tool-error-codes";
import { createSessionContext } from "./tool-guards";

function createMockContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [] },
    workspace: undefined,
    taskId: undefined,
    soulPrompt: "",
    emit: () => {},
    debug: () => {},
    classifiedMode: "work",
    tools: {} as RunContext["tools"],
    mode: "work",
    agentMode: "work",
    model: "gpt-5-mini",
    session: createSessionContext(),
    agent: {} as RunContext["agent"],
    agentInput: "test prompt",
    policy: defaultLifecyclePolicy,
    promptUsage: {
      promptTokens: 0,
      promptBudgetTokens: 8000,
      promptTruncated: false,
      includedHistoryMessages: 0,
      totalHistoryMessages: 0,
    },
    observedTools: new Set(),
    modelCallCount: 1,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    sawEditFileMultiMatchError: false,
    errorStats: createErrorStats(),
    nativeIdQueue: new Map(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
    ...overrides,
  };
}

describe("autoVerifier", () => {
  test("returns regenerate when write tools used without verify", () => {
    const session = createSessionContext("task_new");
    session.callLog = [
      { toolName: "edit-file", args: { path: "src/old.ts" }, taskId: "task_old" },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] }, taskId: "task_new" },
      { toolName: "read-file", args: { paths: [{ path: "src/c.ts" }] }, taskId: "task_new" },
      { toolName: "scan-code", args: { paths: ["src/d.ts"], patterns: ["export function $NAME"] }, taskId: "task_new" },
      { toolName: "edit-file", args: { path: "src/a.ts" }, taskId: "task_new" },
      { toolName: "edit-code", args: { path: "src/b.ts" }, taskId: "task_new" },
    ];
    const ctx = createMockContext({
      classifiedMode: "work",
      taskId: "task_new",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "edit-file"]),
    });
    const action = autoVerifier.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("verify");
      expect(action.keepResult).toBe(true);
      expect(action.prompt).toContain("Task boundary:");
      expect(action.prompt).toContain("- src/a.ts");
      expect(action.prompt).toContain("- src/b.ts");
      expect(action.prompt).toContain("Allowed supporting reads");
      expect(action.prompt).toContain("- src/c.ts");
      expect(action.prompt).toContain("- src/d.ts");
      expect(action.prompt).not.toContain("- src/old.ts");
    }
  });

  test("uses base verify prompt when no write paths are available", () => {
    const ctx = createMockContext({
      classifiedMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = autoVerifier.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.prompt).not.toContain("Task boundary:");
  });

  test("uses global verify prompt when request explicitly opts into global scope", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" } }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "global" },
      classifiedMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = autoVerifier.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.prompt).not.toContain("Task boundary:");
  });

  test("returns done when verifyRan flag is set", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    const ctx = createMockContext({
      classifiedMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done in plan mode", () => {
    const ctx = createMockContext({
      classifiedMode: "plan",
      result: { text: "Found it.", toolCalls: [] },
      observedTools: new Set(["read-file"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no write tools used", () => {
    const ctx = createMockContext({
      classifiedMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
    });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createMockContext({ result: undefined });
    expect(autoVerifier.evaluate(ctx).type).toBe("done");
  });
});

describe("multiMatchEditEvaluator", () => {
  test("returns regenerate when edit-file fails with multi-match error", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/priority.ts" } }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      classifiedMode: "work",
      session,
      observedTools: new Set(["read-file", "edit-file"]),
      sawEditFileMultiMatchError: true,
      lastError: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations (foo…).",
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = multiMatchEditEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.prompt).toContain("next tool call must be edit-code");
      expect(action.prompt).toContain("Use path 'src/priority.ts' for edit-code");
      expect(action.prompt).toContain("do not use '.' or directory paths");
    }
  });

  test("uses concrete-path guidance when no target path is available", () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      classifiedMode: "work",
      observedTools: new Set(["edit-file"]),
      sawEditFileMultiMatchError: true,
      lastError: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 2 locations.",
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = multiMatchEditEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.prompt).toContain("Use a concrete file path for edit-code");
  });

  test("returns done when edit-code was already used", () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      classifiedMode: "work",
      observedTools: new Set(["edit-file", "edit-code"]),
      sawEditFileMultiMatchError: true,
      lastError: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 2 locations.",
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    expect(multiMatchEditEvaluator.evaluate(ctx).type).toBe("done");
  });
});

describe("modeTransition", () => {
  test("plan→work: transitions when plan produced text and used tools", () => {
    const ctx = createMockContext({
      mode: "plan",
      result: { text: "Analysis: the bug is in foo.ts line 42.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
      agentInput: "fix the bug",
    });
    const action = modeTransition.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("work");
      expect(action.keepResult).toBe(true);
      expect(action.prompt).toContain("fix the bug");
      expect(action.prompt).toContain("Now implement the changes");
    }
  });

  test("plan→work: returns done when plan produced no text", () => {
    const ctx = createMockContext({
      mode: "plan",
      result: { text: "", toolCalls: [] },
      observedTools: new Set(["read-file"]),
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });

  test("plan→work: returns done when plan used no tools", () => {
    const ctx = createMockContext({
      mode: "plan",
      result: { text: "Simple answer.", toolCalls: [] },
      observedTools: new Set(),
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });

  test("work→plan: transitions when work failed without writes", () => {
    const ctx = createMockContext({
      mode: "work",
      result: { text: "Could not find the file.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
      lastError: "File not found: src/missing.ts",
      agentInput: "fix the bug",
    });
    const action = modeTransition.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("plan");
      expect(action.prompt).toContain("fix the bug");
      expect(action.prompt).toContain("Re-analyze the problem");
      expect(action.cycleLimit).toBe(defaultLifecyclePolicy.planMaxSteps);
    }
  });

  test("work→plan: returns done when work succeeded", () => {
    const ctx = createMockContext({
      mode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });

  test("work→plan: returns done when work used write tools", () => {
    const ctx = createMockContext({
      mode: "work",
      result: { text: "Partial progress.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
      lastError: "Some error",
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });

  test("returns done when planPhase is disabled", () => {
    const ctx = createMockContext({
      mode: "plan",
      result: { text: "Analysis done.", toolCalls: [] },
      observedTools: new Set(["read-file"]),
      policy: { ...defaultLifecyclePolicy, planPhase: false },
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });

  test("returns done in verify mode", () => {
    const ctx = createMockContext({
      mode: "verify",
      result: { text: "All good.", toolCalls: [] },
    });
    expect(modeTransition.evaluate(ctx).type).toBe("done");
  });
});

describe("evaluator ordering", () => {
  test("evaluators run in correct order", () => {
    const evaluators = [multiMatchEditEvaluator, modeTransition, timeoutRecovery, autoVerifier, verifyFailure];
    expect(evaluators[0].id).toBe("multi-match-edit-evaluator");
    expect(evaluators[1].id).toBe("mode-transition");
    expect(evaluators[2].id).toBe("timeout-recovery");
    expect(evaluators[3].id).toBe("auto-verifier");
    expect(evaluators[4].id).toBe("verify-failure");
  });
});

describe("verifyFailure", () => {
  test("returns regenerate to work mode when verify reports issues", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    const ctx = createMockContext({
      mode: "verify",
      classifiedMode: "work",
      session,
      lastError: "verify failed: missing export updatePost in post-store.ts",
      result: { text: "Error: missing export updatePost in post-store.ts", toolCalls: [] },
      observedTools: new Set(["scan-code"]),
    });
    const action = verifyFailure.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("work");
      expect(action.prompt).toContain("missing export updatePost");
    }
  });

  test("returns done when not in verify mode", () => {
    const ctx = createMockContext({
      mode: "work",
      classifiedMode: "work",
      result: { text: "Error in code", toolCalls: [] },
    });
    expect(verifyFailure.evaluate(ctx).type).toBe("done");
  });

  test("returns done when verify passes cleanly", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    const ctx = createMockContext({
      mode: "verify",
      classifiedMode: "work",
      session,
      result: { text: "", toolCalls: [] },
    });
    expect(verifyFailure.evaluate(ctx).type).toBe("done");
  });

  test("returns done for explicit no-issue verification summaries", () => {
    const session = createSessionContext();
    session.flags.verifyRan = true;
    const ctx = createMockContext({
      mode: "verify",
      classifiedMode: "work",
      session,
      result: { text: "No issues found. 0 errors.", toolCalls: [] },
    });
    expect(verifyFailure.evaluate(ctx).type).toBe("done");
  });
});

describe("timeoutRecovery", () => {
  test("uses policy-configured timeout recovery limits", () => {
    const ctx = createMockContext({
      lastError: "Step timed out after 120000ms of inactivity",
      lastErrorCategory: "timeout",
      policy: {
        ...defaultLifecyclePolicy,
        timeoutRecoveryMaxSteps: 3,
        timeoutRecoveryTimeoutMs: 9_000,
      },
    });
    const action = timeoutRecovery.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.cycleLimit).toBe(3);
      expect(action.timeoutMs).toBe(9_000);
    }
  });
});

describe("recoveryActionForError", () => {
  test("returns none for timeout code (handled by evaluator)", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 })).toBe("none");
  });

  test("returns stop-unknown-budget for repeated unknown errors", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 })).toBe(
      "stop-unknown-budget",
    );
  });

  test("returns none for tool-specific multi-match errors", () => {
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileMultiMatch, unknownErrorCount: 0 })).toBe(
      "none",
    );
  });
});

describe("shouldCommitMemory", () => {
  test("returns false when request disables memory", () => {
    expect(
      shouldCommitMemory({
        request: { model: "gpt-5-mini", message: "test", history: [], useMemory: false },
        soulPrompt: "",
      }),
    ).toBe(false);
  });

  test("returns true when request does not disable memory", () => {
    expect(
      shouldCommitMemory({
        request: { model: "gpt-5-mini", message: "test", history: [] },
        soulPrompt: "",
      }),
    ).toBe(true);
  });
});

describe("scheduleMemoryCommit", () => {
  test("invokes commit function asynchronously", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [],
        output: "done",
      },
      () => {},
      async (ctx) => {
        calls.push({ sessionId: ctx.sessionId });
        return undefined;
      },
      async (_key, job) => {
        await job();
      },
    );
    await Promise.resolve();
    expect(calls).toEqual([{ sessionId: "sess_test0001" }]);
  });

  test("logs debug event when commit fails", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      async () => {
        throw new Error("commit failed");
      },
      async (_key, job) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const failed = events.find((entry) => entry.event === "lifecycle.memory.commit_failed");
    expect(failed).toBeDefined();
    expect(failed?.fields?.session_id).toBe("sess_test0001");
    expect(failed?.fields?.message_count).toBe(1);
    expect(failed?.fields?.output_chars).toBe(4);
    expect(failed?.fields?.queue_key).toBe("sess_test0001");
    expect(failed?.fields?.message).toBe("commit failed");
  });

  test("logs debug events when commit succeeds", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      async () => undefined,
      async (_key, job) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    const scheduled = events.find((entry) => entry.event === "lifecycle.memory.commit_scheduled");
    const done = events.find((entry) => entry.event === "lifecycle.memory.commit_done");
    expect(scheduled).toBeDefined();
    expect(done).toBeDefined();
    expect(scheduled?.fields?.session_id).toBe("sess_test0001");
    expect(scheduled?.fields?.message_count).toBe(1);
    expect(scheduled?.fields?.output_chars).toBe(4);
    expect(done?.fields?.queue_key).toBe("sess_test0001");
    expect(done?.fields?.project_promoted_facts).toBe(0);
    expect(done?.fields?.user_promoted_facts).toBe(0);
    expect(done?.fields?.session_scoped_facts).toBe(0);
    expect(done?.fields?.dropped_untagged_facts).toBe(0);
  });

  test("logs commit metrics when commit returns promotion stats", async () => {
    const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    scheduleMemoryCommit(
      {
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      },
      (event, fields) => {
        events.push({ event, fields });
      },
      async () => ({
        projectPromotedFacts: 2,
        userPromotedFacts: 1,
        sessionScopedFacts: 3,
        droppedUntaggedFacts: 4,
      }),
      async (_key, job) => {
        await job();
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    const done = events.find((entry) => entry.event === "lifecycle.memory.commit_done");
    expect(done).toBeDefined();
    expect(done?.fields?.project_promoted_facts).toBe(2);
    expect(done?.fields?.user_promoted_facts).toBe(1);
    expect(done?.fields?.session_scoped_facts).toBe(3);
    expect(done?.fields?.dropped_untagged_facts).toBe(4);
  });
});
