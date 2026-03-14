import { describe, expect, test } from "bun:test";
import { createErrorStats } from "./error-handling";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./error-primitives";
import { scheduleMemoryCommit, shouldCommitMemory } from "./lifecycle";
import type { RunContext } from "./lifecycle-contract";
import { recoveryActionForError } from "./lifecycle-evaluate";
import {
  guardRecoveryEvaluator,
  repeatedFailureEvaluator,
  toolRecoveryEvaluator,
  verifyCycle,
} from "./lifecycle-evaluators";
import { phaseFinalize } from "./lifecycle-finalize";
import {
  consumeLifecycleFeedback,
  createGenerationInput,
  createLifecycleFeedbackText,
  phaseGenerate,
} from "./lifecycle-generate";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import { acceptedLifecycleSignal, updateRepeatedFailureState } from "./lifecycle-state";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
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
      inputTokens: 0,
      systemPromptTokens: 0,
      toolTokens: 0,
      memoryTokens: 0,
      messageTokens: 0,
      inputBudgetTokens: 8000,
      inputTruncated: false,
      includedHistoryMessages: 0,
      totalHistoryMessages: 0,
    },
    lifecycleState: { feedback: [], verifyOutcome: undefined, repeatedFailure: undefined },
    observedTools: new Set(),
    modelCallCount: 1,
    inputTokensAccum: 0,
    outputTokensAccum: 0,
    promptBreakdownTotals: createEmptyPromptBreakdownTotals(),
    streamingChars: 0,
    lastUsageEmitChars: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
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
      { toolName: "edit-file", args: { path: "src/old.ts" }, taskId: "task_old", status: "succeeded" },
      { toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] }, taskId: "task_new", status: "succeeded" },
      { toolName: "read-file", args: { paths: [{ path: "src/c.ts" }] }, taskId: "task_new", status: "succeeded" },
      {
        toolName: "scan-code",
        args: { paths: ["src/d.ts"], patterns: ["export function $NAME"] },
        taskId: "task_new",
        status: "succeeded",
      },
      { toolName: "edit-file", args: { path: "src/a.ts" }, taskId: "task_new", status: "succeeded" },
      { toolName: "edit-code", args: { path: "src/b.ts" }, taskId: "task_new", status: "succeeded" },
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
      expect(action.feedback?.details).toContain("Task boundary:");
      expect(action.feedback?.details).toContain("- src/a.ts");
      expect(action.feedback?.details).toContain("- src/b.ts");
      expect(action.feedback?.details).toContain("Allowed supporting reads");
      expect(action.feedback?.details).toContain("- src/c.ts");
      expect(action.feedback?.details).toContain("- src/d.ts");
      expect(action.feedback?.details).not.toContain("- src/old.ts");
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
    if (action.type === "regenerate") expect(action.feedback?.details).not.toContain("Task boundary:");
  });

  test("uses global verify prompt when request explicitly opts into global scope", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" }, status: "succeeded" }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "global" },
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    const action = verifyCycle.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") expect(action.feedback?.details).not.toContain("Task boundary:");
  });

  test("returns done when request disables verification", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/a.ts" }, status: "succeeded" }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Implement fix", history: [], verifyScope: "none" },
      initialMode: "work",
      session,
      result: { text: "Done.", toolCalls: [] },
      observedTools: new Set(["edit-file"]),
    });
    expect(verifyCycle.evaluate(ctx).type).toBe("done");
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
      expect(action.feedback?.details).toContain("missing export updatePost");
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

describe("phaseGenerate", () => {
  test("does not clear an edit-file error after an unrelated successful read", async () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream() {
          const chunks = [
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_1", toolName: "edit-file", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "edit-file",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "edit-file" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "read-file", args: { paths: [{ path: "src/a.ts" }] } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "read-file", result: { output: "File: src/a.ts" } },
            },
          ];
          return {
            fullStream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "Done.", toolCalls: [], signal: "done" as const };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(ctx.currentError?.tool).toBe("edit-file");
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("clears an edit-file error after a later successful write recovery", async () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream() {
          const chunks = [
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_1", toolName: "edit-file", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "edit-file",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "edit-file" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "edit-file", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "edit-file", result: { ok: true } },
            },
          ];
          return {
            fullStream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "Done.", toolCalls: [], signal: "done" as const };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(ctx.currentError).toBeUndefined();
    expect(acceptedLifecycleSignal(ctx)).toBe("done");
  });

  test("does not clear an edit-file error after a different write tool succeeds", async () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream() {
          const chunks = [
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_1", toolName: "edit-file", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "edit-file",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "edit-file" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "create-file", args: { path: "src/b.ts" } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "create-file", result: { ok: true } },
            },
          ];
          return {
            fullStream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk);
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "Done.", toolCalls: [], signal: "done" as const };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(ctx.currentError?.tool).toBe("edit-file");
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });
});

describe("acceptedLifecycleSignal", () => {
  test("accepts done when no contradiction exists", () => {
    const ctx = createMockContext({
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBe("done");
  });

  test("accepts blocked when no contradiction exists", () => {
    const ctx = createMockContext({
      result: { text: "Blocked by a missing file.", toolCalls: [], signal: "blocked" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBe("blocked");
  });

  test("rejects no_op after writes happened", () => {
    const session = createSessionContext("task_noop");
    session.writeTools = new Set(["edit-file"]);
    recordCall(session, "edit-file", { path: "src/a.ts" });
    const ctx = createMockContext({
      taskId: "task_noop",
      session,
      result: { text: "No changes were needed.", toolCalls: [], signal: "no_op" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("rejects any signal when a current error exists", () => {
    const ctx = createMockContext({
      currentError: { message: "verify failed", category: "other" },
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("rejects done after a guard-blocked error", () => {
    const ctx = createMockContext({
      currentError: { message: "duplicate tool call blocked", category: "guard-blocked" },
      result: { text: "Finished the requested change.", toolCalls: [], signal: "done" },
    });
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });
});

describe("phaseFinalize", () => {
  test("uses estimated prompt tokens when stream usage is unavailable", () => {
    const ctx = createMockContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 8,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(80);
    expect(response.usage?.totalTokens).toBe(81);
    expect(response.promptBreakdown?.usedTokens).toBe(80);
  });

  test("includes promptBreakdown when currentError is set", () => {
    const ctx = createMockContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 8,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      currentError: { message: "tool failed", category: "other" },
      result: { text: "", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.error).toBe("tool failed");
    expect(response.promptBreakdown).toBeDefined();
    expect(response.promptBreakdown?.usedTokens).toBe(80);
  });

  test("uses accumulated prompt breakdown totals across multiple model calls", () => {
    const ctx = createMockContext({
      baseAgentInput: "USER: first prompt",
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 8,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 120,
      promptBreakdownTotals: {
        systemTokens: 80,
        toolTokens: 40,
        memoryTokens: 16,
        messageTokens: 34,
      },
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(170);
    expect(response.promptBreakdown).toEqual({
      budgetTokens: 100,
      usedTokens: 170,
      systemTokens: 80,
      toolTokens: 40,
      memoryTokens: 16,
      messageTokens: 34,
    });
  });
});

describe("guardRecoveryEvaluator", () => {
  test("returns regenerate when guard-blocked error has pending guard feedback", () => {
    const ctx = createMockContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [
          {
            source: "guard",
            mode: "work",
            summary: "The previous read-file call already used these arguments.",
            instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
          },
        ],
        verifyOutcome: undefined,
      },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "regenerate" });
  });

  test("returns done when no pending guard feedback exists", () => {
    const ctx = createMockContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
    });

    expect(guardRecoveryEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });
});

describe("repeatedFailureEvaluator", () => {
  test("returns regenerate when the same non-guard failure repeats", () => {
    const ctx = createMockContext({
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "other:tool-error:run-command:E_COMMAND_FAILED",
          count: 2,
          status: "pending",
        },
      },
    });

    const action = repeatedFailureEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.summary).toBe("The same runtime failure has repeated.");
      expect(action.feedback?.details).toContain("command exited with code 1");
      expect(action.feedback?.instruction).toContain("Change approach");
    }
    expect(ctx.lifecycleState.repeatedFailure?.status).toBe("surfaced");
  });

  test("returns done for repeated guard-blocked failures", () => {
    const ctx = createMockContext({
      currentError: { message: "Duplicate read-file call detected", category: "guard-blocked" },
      result: { text: "Attempted read.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "guard-blocked:tool-error:none:E_GUARD_BLOCKED",
          count: 2,
          status: "pending",
        },
      },
    });

    expect(repeatedFailureEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("returns done after the repeated failure streak was already surfaced", () => {
    const ctx = createMockContext({
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
      result: { text: "Attempted fix.", toolCalls: [] },
      lifecycleState: {
        feedback: [],
        verifyOutcome: undefined,
        repeatedFailure: {
          signature: "other:tool-error:run-command:E_COMMAND_FAILED",
          count: 3,
          status: "surfaced",
        },
      },
    });

    expect(repeatedFailureEvaluator.evaluate(ctx)).toEqual({ type: "done" });
  });

  test("tracks different run-command failures as different repeated-failure streaks", () => {
    const session = createSessionContext("task_repeat");
    recordCall(session, "run-command", { command: "bun test src/a.test.ts" });

    const ctx = createMockContext({
      taskId: "task_repeat",
      session,
      currentError: {
        message: "run-command failed: command exited with code 1",
        category: "other",
        code: "E_COMMAND_FAILED",
        tool: "run-command",
        source: "tool-error",
      },
    });

    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);

    recordCall(session, "run-command", { command: "bun test src/b.test.ts" });
    updateRepeatedFailureState(ctx);
    expect(ctx.lifecycleState.repeatedFailure?.count).toBe(1);
    expect(ctx.lifecycleState.repeatedFailure?.signature).toContain("src/b.test.ts");
  });
});

describe("toolRecoveryEvaluator", () => {
  test("returns regenerate when edit-file exposes structured recovery", () => {
    const session = createSessionContext();
    session.callLog = [{ toolName: "edit-file", args: { path: "src/priority.ts" }, status: "failed" }];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      observedTools: new Set(["read-file", "edit-file"]),
      currentError: {
        code: "E_EDIT_FILE_MULTI_MATCH",
        message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations (foo…).",
        tool: "edit-file",
        recovery: {
          tool: "edit-file",
          kind: "disambiguate-match",
          summary: "Your edit-file snippet matched multiple locations.",
          instruction: "Keep the change in 'src/priority.ts' and make one bounded edit with a more unique snippet.",
        },
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("edit-file");
      expect(action.feedback?.summary).toBe("Your edit-file snippet matched multiple locations.");
      expect(action.feedback?.details).toContain("Find text matched 3 locations");
      expect(action.feedback?.instruction).toContain("src/priority.ts");
    }
  });

  test("returns regenerate when edit-code exposes structured recovery", () => {
    const ctx = createMockContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editCodeNoMatch,
        tool: "edit-code",
        message: "edit-code failed: [E_EDIT_CODE_NO_MATCH] No AST matches found for pattern: return $VALUE",
        recovery: {
          tool: "edit-code",
          kind: "refine-pattern",
          summary: "Your AST pattern did not match the current file.",
          instruction: "Refine the pattern against the latest file syntax.",
        },
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("edit-code");
      expect(action.feedback?.summary).toBe("Your AST pattern did not match the current file.");
      expect(action.feedback?.details).toContain("No AST matches found");
      expect(action.feedback?.instruction).toContain("Refine the pattern");
    }
  });

  test("returns regenerate when scan-code exposes structured recovery", () => {
    const ctx = createMockContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
        tool: "scan-code",
        message:
          "scan-code failed: [E_SCAN_CODE_UNSUPPORTED_FILE] scan-code requires a supported code file, got: notes.yaml",
        recovery: {
          tool: "scan-code",
          kind: "use-supported-file",
          summary: "scan-code only works on supported code files.",
          instruction: "Use scan-code on a supported code file or directory, or switch to search-files.",
        },
      },
      result: { text: "Attempted scan.", toolCalls: [] },
    });
    const action = toolRecoveryEvaluator.evaluate(ctx);
    expect(action.type).toBe("regenerate");
    if (action.type === "regenerate") {
      expect(action.feedback?.source).toBe("scan-code");
      expect(action.feedback?.summary).toBe("scan-code only works on supported code files.");
      expect(action.feedback?.details).toContain("notes.yaml");
      expect(action.feedback?.instruction).toContain("search-files");
    }
  });

  test("returns done when there is no structured tool recovery", () => {
    const ctx = createMockContext({
      initialMode: "work",
      currentError: {
        code: TOOL_ERROR_CODES.editFileFindTooLarge,
        tool: "edit-file",
        message: "edit-file failed: find must be a short unique snippet",
      },
      result: { text: "Attempted edit.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
  });

  test("returns done after a later successful write for disambiguate-match recovery", () => {
    const session = createSessionContext();
    session.writeTools = new Set(["edit-file", "edit-code"]);
    session.callLog = [
      { toolName: "edit-file", args: { path: "src/priority.ts" }, status: "failed" },
      { toolName: "edit-file", args: { path: "src/priority.ts" }, status: "succeeded" },
    ];
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "Rename symbol everywhere", history: [] },
      initialMode: "work",
      session,
      currentError: {
        tool: "edit-file",
        message: "edit-file failed: [E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations.",
        recovery: {
          tool: "edit-file",
          kind: "disambiguate-match",
          summary: "Your edit-file snippet matched multiple locations.",
          instruction: "Use a more unique snippet.",
        },
      },
      result: { text: "Applied the change.", toolCalls: [] },
    });
    expect(toolRecoveryEvaluator.evaluate(ctx).type).toBe("done");
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
          { source: "verify", mode: "verify", summary: "Run verification.", details: "Task boundary:\n- src/a.ts" },
          { source: "lint", mode: "work", summary: "Lint errors detected" },
          { source: "edit-file", mode: "work", summary: "Use a bounded edit next" },
        ],
      },
    });
    expect(input).toContain("USER: fix it");
    expect(input).toContain("Lifecycle feedback (lint)");
    expect(input).toContain("Lint errors detected");
    expect(input).toContain("Lifecycle feedback (edit-file)");
    expect(input).toContain("Use a bounded edit next");
    expect(input).not.toContain("Task boundary:\n- src/a.ts");
  });
});

describe("createLifecycleFeedbackText", () => {
  test("renders summary, details, and instruction in a single lifecycle-owned format", () => {
    const text = createLifecycleFeedbackText({
      source: "lint",
      mode: "work",
      summary: "Lint errors detected in files you edited.",
      details: "src/a.ts:1:1 error unexpected any",
      instruction: "Fix the issues above, then stop.",
    });

    expect(text).toContain("SYSTEM: Lifecycle feedback (lint):");
    expect(text).toContain("Lint errors detected in files you edited.");
    expect(text).toContain("src/a.ts:1:1 error unexpected any");
    expect(text).toContain("Fix the issues above, then stop.");
  });
});

describe("consumeLifecycleFeedback", () => {
  test("returns and clears pending feedback for the active mode only", () => {
    const state = {
      feedback: [
        {
          source: "verify" as const,
          mode: "verify" as const,
          summary: "Run verification.",
          details: "Task boundary:\n- src/a.ts",
        },
        { source: "lint" as const, mode: "work" as const, summary: "Lint errors detected" },
        { source: "edit-file" as const, mode: "work" as const, summary: "Use a bounded edit next" },
      ],
    };

    const consumed = consumeLifecycleFeedback(state, "work");

    expect(consumed).toEqual([
      { source: "lint", mode: "work", summary: "Lint errors detected" },
      { source: "edit-file", mode: "work", summary: "Use a bounded edit next" },
    ]);
    expect(state.feedback).toEqual([
      { source: "verify", mode: "verify", summary: "Run verification.", details: "Task boundary:\n- src/a.ts" },
    ]);
  });

  test("does not leak consumed feedback into later prompt creation", () => {
    const state = {
      feedback: [{ source: "lint" as const, mode: "work" as const, summary: "Lint errors detected" }],
    };

    expect(
      createGenerationInput({
        baseAgentInput: "USER: fix it",
        mode: "work",
        lifecycleState: state,
      }),
    ).toContain("Lint errors detected");

    consumeLifecycleFeedback(state, "work");

    expect(
      createGenerationInput({
        baseAgentInput: "USER: fix it",
        mode: "work",
        lifecycleState: state,
      }),
    ).toBe("USER: fix it");
  });
});
