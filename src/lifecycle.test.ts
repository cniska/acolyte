import { describe, expect, test } from "bun:test";
import { createErrorStats } from "./error-handling";
import { scheduleMemoryCommit, shouldCommitMemory } from "./lifecycle";
import type { RunContext } from "./lifecycle-contract";
import { recoveryActionForError } from "./lifecycle-evaluate";
import { multiMatchEditEvaluator, verifyCycle } from "./lifecycle-evaluators";
import { consumeLifecycleFeedback, createGenerationInput } from "./lifecycle-generate";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./tool-error-codes";
import { createSessionContext, recordCall } from "./tool-guards";

function createMockContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [] },
    workspace: undefined,
    taskId: undefined,
    soulPrompt: "",
    emit: () => {},
    debug: () => {},
    initialMode: "work",
    tools: {} as RunContext["tools"],
    mode: "work",
    agentForMode: "work",
    model: "gpt-5-mini",
    session: createSessionContext(),
    agent: {} as RunContext["agent"],
    baseAgentInput: "test prompt",
    policy: defaultLifecyclePolicy,
    promptUsage: {
      promptTokens: 0,
      systemPromptTokens: 0,
      promptBudgetTokens: 8000,
      promptTruncated: false,
      includedHistoryMessages: 0,
      totalHistoryMessages: 0,
    },
    lifecycleState: { feedback: [], verifyOutcome: undefined },
    observedTools: new Set(),
    modelCallCount: 1,
    promptTokensAccum: 0,
    completionTokensAccum: 0,
    streamingChars: 0,
    lastUsageEmitChars: 0,
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

describe("verifyCycle", () => {
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
      initialMode: "work",
      taskId: "task_new",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("verify");
      expect(action.keepResult).toBe(true);
      expect(action.feedback?.content).toContain("Task boundary:");
      expect(action.feedback?.content).toContain("- src/a.ts");
      expect(action.feedback?.content).toContain("- src/b.ts");
      expect(action.feedback?.content).toContain("Allowed supporting reads");
      expect(action.feedback?.content).toContain("- src/c.ts");
      expect(action.feedback?.content).toContain("- src/d.ts");
      expect(action.feedback?.content).not.toContain("- src/old.ts");
    }
  });

  test("uses base verify prompt when no write paths are available", () => {
    const ctx = createMockContext({
      initialMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.content).not.toContain("Task boundary:");
  });

  test("uses global verify prompt when request explicitly opts into global scope", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" } }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "global" },
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.content).not.toContain("Task boundary:");
  });

  test("returns done when verify already ran", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createMockContext({
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no write tools used", () => {
    const ctx = createMockContext({
      initialMode: "work",
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["read-file", "search-files"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done when no result", () => {
    const ctx = createMockContext({ result: undefined });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns regenerate to work mode when verify reports issues", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createMockContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: {
          text: "Error: missing export updatePost in post-store.ts",
          error: { message: "verify failed: missing export updatePost in post-store.ts" },
        },
      },
      observedTools: new Set(["scan-code"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.mode).toBe("work");
      expect(action.feedback?.content).toContain("missing export updatePost");
    }
  });

  test("returns done when in verify mode without errors", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createMockContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "", toolCalls: [] },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("ignores restored work result when verify outcome is missing", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createMockContext({
      mode: "verify",
      initialMode: "work",
      session,
      currentError: undefined,
      result: { text: "Done.", toolCalls: [] },
      lifecycleState: { feedback: [], verifyOutcome: undefined },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });

  test("returns done for explicit no-issue verification summaries", () => {
    const session = createSessionContext();
    session.mode = "verify";
    recordCall(session, "run-command", { command: "bun run verify" });
    const ctx = createMockContext({
      mode: "verify",
      initialMode: "work",
      session,
      result: { text: "No issues found. 0 errors.", toolCalls: [] },
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
  });
});

describe("multiMatchEditEvaluator", () => {
  test("returns regenerate when edit-file fails with multi-match error", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/priority.ts" } }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      observedTools: new Set(["read-file", "edit-file"]),
      sawEditFileMultiMatchError: true,
      currentError: { message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations (foo…)." },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = multiMatchEditEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.content).toContain("next tool call must be edit-code");
      expect(action.feedback?.content).toContain("Use path 'src/priority.ts' for edit-code");
      expect(action.feedback?.content).toContain("do not use '.' or directory paths");
    }
  });

  test("uses concrete-path guidance when no target path is available", () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      observedTools: new Set(["edit-file"]),
      sawEditFileMultiMatchError: true,
      currentError: { message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 2 locations." },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = multiMatchEditEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.content).toContain("Use a concrete file path for edit-code");
  });

  test("returns done when edit-code was already used", () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      observedTools: new Set(["edit-file", "edit-code"]),
      sawEditFileMultiMatchError: true,
      currentError: { message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 2 locations." },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    expect(multiMatchEditEvaluator.evaluate(ctx).type).toBe("done");
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

describe("phasePrepare", () => {
  test("applies lifecycle policy to tool session context", () => {
    const policy = {
      ...defaultLifecyclePolicy,
      toolTimeoutMs: 1_234,
      consecutiveGuardBlockLimit: 7,
    };
    const prepared = phasePrepare({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      workspace: undefined,
      taskId: "task_test0001",
      soulPrompt: "",
      initialMode: "work",
      model: "gpt-5-mini",
      policy,
      debug: () => {},
      onOutput: () => {},
    });
    expect(prepared.session.toolTimeoutMs).toBe(1_234);
    expect(prepared.session.flags.consecutiveGuardBlockLimit).toBe(7);
  });
});

describe("createGenerationInput", () => {
  test("returns base input when there is no feedback", () => {
    const input = createGenerationInput({
      baseAgentInput: "USER: fix it",
      mode: "work",
      lifecycleState: { feedback: [] },
    });
    expect(input).toBe("USER: fix it");
  });

  test("appends only active-mode feedback in order", () => {
    const input = createGenerationInput({
      baseAgentInput: "USER: fix it",
      mode: "work",
      lifecycleState: {
        feedback: [
          { source: "verify", mode: "verify", content: "Task boundary:\n- src/a.ts" },
          { source: "lint", mode: "work", content: "Lint errors detected" },
          { source: "multi-match", mode: "work", content: "Use edit-code next" },
        ],
      },
    });
    expect(input).toContain("USER: fix it");
    expect(input).toContain("Lifecycle feedback (lint)");
    expect(input).toContain("Lint errors detected");
    expect(input).toContain("Lifecycle feedback (multi-match)");
    expect(input).toContain("Use edit-code next");
    expect(input).not.toContain("Task boundary:\n- src/a.ts");
  });
});

describe("consumeLifecycleFeedback", () => {
  test("returns and clears pending feedback for the active mode only", () => {
    const state = {
      feedback: [
        { source: "verify" as const, mode: "verify" as const, content: "Task boundary:\n- src/a.ts" },
        { source: "lint" as const, mode: "work" as const, content: "Lint errors detected" },
        { source: "multi-match" as const, mode: "work" as const, content: "Use edit-code next" },
      ],
    };

    const consumed = consumeLifecycleFeedback(state, "work");

    expect(consumed).toEqual([
      { source: "lint", mode: "work", content: "Lint errors detected" },
      { source: "multi-match", mode: "work", content: "Use edit-code next" },
    ]);
    expect(state.feedback).toEqual([{ source: "verify", mode: "verify", content: "Task boundary:\n- src/a.ts" }]);
  });
});
