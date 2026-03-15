import { describe, expect, test } from "bun:test";
import { TOOL_ERROR_CODES } from "./error-contract";
import { createErrorStats } from "./error-handling";
import type { RunContext } from "./lifecycle-contract";
import { phaseGenerate } from "./lifecycle-generate";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { acceptedLifecycleSignal } from "./lifecycle-state";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
import { createSessionContext } from "./tool-guards";

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

  test("fails fast when fullOutput rejects outside the reader chain", async () => {
    const ctx = createMockContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream() {
          return {
            fullStream: new ReadableStream({ start() {} }), // never emits — reader.read() hangs
            async getFullOutput() {
              throw new Error("invalid_api_key");
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    expect(ctx.currentError?.message).toBe("invalid_api_key");
    expect(ctx.currentError?.source).toBe("generate");
  });
});
