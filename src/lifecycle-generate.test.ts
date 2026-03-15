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
  test("does not clear an edit-file error after an unrelated successful read", async () => {
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

  test("clears a search-files recovery after read-file succeeds on the suggested path", async () => {
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
                toolName: "search-files",
                args: { patterns: ["alias"], paths: ["src/provider-config.ts"] },
              },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "search-files",
                error: {
                  message: "search-files found no matches in scoped file: src/provider-config.ts",
                  code: TOOL_ERROR_CODES.searchFilesNoMatch,
                  recovery: {
                    tool: "search-files" as const,
                    kind: "switch-to-read" as const,
                    summary: "Your search-files query found no matches in the scoped file.",
                    instruction: "Switch to read-file and inspect the file directly.",
                    nextTool: "read-file" as const,
                    targetPaths: ["src/provider-config.ts"],
                    resolvesOn: [{ tool: "read-file" as const, targetPaths: ["src/provider-config.ts"] }],
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: {
                toolCallId: "call_2",
                toolName: "read-file",
                args: { paths: [{ path: "src/provider-config.ts" }] },
              },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "read-file", result: { output: "File: src/provider-config.ts" } },
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

  test("does not clear a search-files recovery after read-file succeeds on a different path", async () => {
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
                toolName: "search-files",
                args: { patterns: ["alias"], paths: ["src/provider-config.ts"] },
              },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "search-files",
                error: {
                  message: "search-files found no matches in scoped file: src/provider-config.ts",
                  code: TOOL_ERROR_CODES.searchFilesNoMatch,
                  recovery: {
                    tool: "search-files" as const,
                    kind: "switch-to-read" as const,
                    summary: "Your search-files query found no matches in the scoped file.",
                    instruction: "Switch to read-file and inspect the file directly.",
                    nextTool: "read-file" as const,
                    targetPaths: ["src/provider-config.ts"],
                    resolvesOn: [{ tool: "read-file" as const, targetPaths: ["src/provider-config.ts"] }],
                  },
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: {
                toolCallId: "call_2",
                toolName: "read-file",
                args: { paths: [{ path: "src/other.ts" }] },
              },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "read-file", result: { output: "File: src/other.ts" } },
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

    expect(ctx.currentError?.tool).toBe("search-files");
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

  test("appends only active-mode feedback in order", () => {
    const input = createGenerationInput({
      baseAgentInput: "USER: fix it",
      mode: "work",
      lifecycleState: {
        feedback: [
          { source: "verify", mode: "verify", summary: "Run verification.", details: "Task boundary:\n- src/a.ts" },
          { source: "lint", mode: "work", summary: "Lint errors detected" },
          { source: "tool-recovery", mode: "work", summary: "Use a bounded edit next" },
        ],
      },
    });
    expect(input).toContain("USER: fix it");
    expect(input).toContain("Lifecycle feedback (lint)");
    expect(input).toContain("Lint errors detected");
    expect(input).toContain("Lifecycle feedback (tool-recovery)");
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
        {
          source: "tool-recovery" as const,
          mode: "work" as const,
          summary: "Use a bounded edit next",
        },
      ],
    };

    const consumed = consumeLifecycleFeedback(state, "work");

    expect(consumed).toEqual([
      { source: "lint", mode: "work", summary: "Lint errors detected" },
      { source: "tool-recovery", mode: "work", summary: "Use a bounded edit next" },
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
