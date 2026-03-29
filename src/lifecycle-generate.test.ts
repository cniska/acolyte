import { describe, expect, test } from "bun:test";
import { TOOL_ERROR_CODES } from "./error-contract";
import type { RunContext } from "./lifecycle-contract";
import {
  consumeLifecycleFeedback,
  createGenerationInput,
  createLifecycleFeedbackText,
  phaseGenerate,
} from "./lifecycle-generate";
import { acceptedLifecycleSignal } from "./lifecycle-state";
import { createRunContext } from "./test-utils";

describe("phaseGenerate", () => {
  test("does not clear a file-edit error after an unrelated successful read", async () => {
    const ctx = createRunContext({
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
              payload: { toolCallId: "call_1", toolName: "file-edit", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-edit",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "file-edit" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "file-read", args: { paths: [{ path: "src/a.ts" }] } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "file-read", result: { output: "File: src/a.ts" } },
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

    expect(ctx.currentError?.tool).toBe("file-edit");
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("clears a file-edit error after a later successful write recovery", async () => {
    const ctx = createRunContext({
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
              payload: { toolCallId: "call_1", toolName: "file-edit", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-edit",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "file-edit" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "file-edit", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "file-edit", result: { ok: true } },
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

  test("does not clear a file-edit error after a different write tool succeeds", async () => {
    const ctx = createRunContext({
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
              payload: { toolCallId: "call_1", toolName: "file-edit", args: { path: "src/a.ts" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-edit",
                error: {
                  message: "Find text not found",
                  code: TOOL_ERROR_CODES.editFileFindNotFound,
                  recovery: {
                    tool: "file-edit" as const,
                    kind: "refresh-snippet" as const,
                    summary: "Refresh the snippet.",
                    instruction: "Reread the file and rebuild the edit.",
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "file-create", args: { path: "src/b.ts" } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "file-create", result: { ok: true } },
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

    expect(ctx.currentError?.tool).toBe("file-edit");
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("clears a file-search recovery after file-read succeeds on the suggested path", async () => {
    const ctx = createRunContext({
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
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                args: { patterns: ["alias"], paths: ["src/provider-config.ts"] },
              },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                error: {
                  message: "file-search found no matches in scoped file: src/provider-config.ts",
                  code: TOOL_ERROR_CODES.searchFilesNoMatch,
                  recovery: {
                    tool: "file-search" as const,
                    kind: "switch-to-read" as const,
                    summary: "Your file-search query found no matches in the scoped file.",
                    instruction: "Switch to file-read and inspect the file directly.",
                    nextTool: "file-read" as const,
                    targetPaths: ["src/provider-config.ts"],
                    resolvesOn: [{ tool: "file-read" as const, targetPaths: ["src/provider-config.ts"] }],
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: {
                toolCallId: "call_2",
                toolName: "file-read",
                args: { paths: [{ path: "src/provider-config.ts" }] },
              },
            },
            {
              type: "tool-result" as const,
              payload: {
                toolCallId: "call_2",
                toolName: "file-read",
                result: { output: "File: src/provider-config.ts" },
              },
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

  test("does not clear a file-search recovery after file-read succeeds on a different path", async () => {
    const ctx = createRunContext({
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
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                args: { patterns: ["alias"], paths: ["src/provider-config.ts"] },
              },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                error: {
                  message: "file-search found no matches in scoped file: src/provider-config.ts",
                  code: TOOL_ERROR_CODES.searchFilesNoMatch,
                  recovery: {
                    tool: "file-search" as const,
                    kind: "switch-to-read" as const,
                    summary: "Your file-search query found no matches in the scoped file.",
                    instruction: "Switch to file-read and inspect the file directly.",
                    nextTool: "file-read" as const,
                    targetPaths: ["src/provider-config.ts"],
                    resolvesOn: [{ tool: "file-read" as const, targetPaths: ["src/provider-config.ts"] }],
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: {
                toolCallId: "call_2",
                toolName: "file-read",
                args: { paths: [{ path: "src/other.ts" }] },
              },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "file-read", result: { output: "File: src/other.ts" } },
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

    expect(ctx.currentError?.tool).toBe("file-search");
    expect(acceptedLifecycleSignal(ctx)).toBeUndefined();
  });

  test("fails fast when fullOutput rejects outside the reader chain", async () => {
    const ctx = createRunContext({
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

describe("createGenerationInput", () => {
  test("returns base input when there is no feedback", () => {
    const input = createGenerationInput({
      baseAgentInput: "USER: fix it",
      mode: "work",
      lifecycleState: { feedback: [] },
    });
    expect(input).toBe("USER: fix it");
  });

  test("appends all pending feedback in order", () => {
    const input = createGenerationInput({
      baseAgentInput: "USER: fix it",
      lifecycleState: {
        feedback: [
          { source: "lint", summary: "Lint errors detected" },
          { source: "tool-recovery", summary: "Use a bounded edit next" },
        ],
      },
    });
    expect(input).toContain("USER: fix it");
    expect(input).toContain("Lifecycle feedback (lint)");
    expect(input).toContain("Lint errors detected");
    expect(input).toContain("Lifecycle feedback (tool-recovery)");
    expect(input).toContain("Use a bounded edit next");
  });
});

describe("createLifecycleFeedbackText", () => {
  test("renders summary, details, and instruction in a single lifecycle-owned format", () => {
    const text = createLifecycleFeedbackText({
      source: "lint",
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
  test("returns and clears all pending feedback", () => {
    const state = {
      feedback: [
        { source: "lint" as const, summary: "Lint errors detected" },
        { source: "tool-recovery" as const, summary: "Use a bounded edit next" },
      ],
    };

    const consumed = consumeLifecycleFeedback(state);

    expect(consumed).toEqual([
      { source: "lint", summary: "Lint errors detected" },
      { source: "tool-recovery", summary: "Use a bounded edit next" },
    ]);
    expect(state.feedback).toEqual([]);
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
