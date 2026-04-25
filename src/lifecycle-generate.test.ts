import { describe, expect, test } from "bun:test";
import type { StreamEvent } from "./client-contract";
import { TOOL_ERROR_CODES } from "./error-contract";
import { resolveSignal } from "./lifecycle";
import type { LifecycleDebugEvent, RunContext } from "./lifecycle-contract";
import { phaseGenerate } from "./lifecycle-generate";
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
              payload: { toolCallId: "call_2", toolName: "file-read", args: { path: "src/a.ts" } },
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
    expect(resolveSignal(ctx)).toBeUndefined();
  });

  test("marks tool-error completion as failed in trace", async () => {
    const debugEvents: LifecycleDebugEvent[] = [];
    const streamEvents: StreamEvent[] = [];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
      emit: (event) => streamEvents.push(event),
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
                  message: "Find text matched 2 locations",
                  code: TOOL_ERROR_CODES.editFileMultiMatch,
                },
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

    const toolResult = streamEvents.find((event) => event.type === "tool-result");
    expect(toolResult).toMatchObject({ type: "tool-result", toolName: "file-edit", isError: true });
    const traceResult = debugEvents.find((event) => event.event === "lifecycle.tool.result");
    expect(traceResult?.fields).toMatchObject({ tool: "file-edit", is_error: true });
  });

  test("marks nonzero command results as failed", async () => {
    const debugEvents: LifecycleDebugEvent[] = [];
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
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
              payload: { toolCallId: "call_1", toolName: "test-run", args: { files: ["src/a.test.ts"] } },
            },
            {
              type: "tool-result" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "test-run",
                result: { kind: "test-run", command: "bun test src/a.test.ts", exitCode: 1, output: "failed" },
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

    expect(ctx.currentError?.source).toBe("tool-result");
    expect(ctx.currentError?.message).toBe("test-run exited with code 1: bun test src/a.test.ts");
    expect(resolveSignal(ctx)).toBeUndefined();
    const traceResult = debugEvents.find((event) => event.event === "lifecycle.tool.result");
    expect(traceResult?.fields).toMatchObject({ tool: "test-run", is_error: true });
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
    expect(resolveSignal(ctx)).toBe("done");
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
    expect(resolveSignal(ctx)).toBeUndefined();
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

  test("accounts memory recall tokens from memory-search results", async () => {
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
              payload: { toolCallId: "call_1", toolName: "memory-search", args: { query: "auth" } },
            },
            {
              type: "tool-result" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "memory-search",
                result: {
                  kind: "memory-search",
                  results: [{ id: "mem_1", content: "Use OAuth", scope: "project" }],
                },
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

    expect(ctx.promptUsage.memoryTokens).toBeGreaterThan(0);
  });

  test("does not account memory recall tokens for failed memory-search", async () => {
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
              payload: { toolCallId: "call_1", toolName: "memory-search", args: { query: "auth" } },
            },
            {
              type: "tool-result" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "memory-search",
                result: { error: "backend unavailable" },
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

    expect(ctx.promptUsage.memoryTokens).toBe(0);
  });
});
