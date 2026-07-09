import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4Message, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { StreamOptions } from "./agent-contract";
import { createAgentStream } from "./agent-stream";
import type { StreamEvent } from "./client-contract";
import { TOOL_ERROR_CODES } from "./error-contract";
import { resolveSignal } from "./lifecycle";
import type { LifecycleDebugEvent, RunContext } from "./lifecycle-contract";
import { phaseGenerate } from "./lifecycle-generate";
import type { RateLimiter } from "./rate-limiter";
import { createSignalToolkit } from "./signal-toolkit";
import { createRunContext } from "./test-utils";
import type { ToolDefinition } from "./tool-contract";
import { WRITE_TOOL_SET } from "./tool-registry";
import { createSessionContext } from "./tool-session";

const noopRateLimiter: RateLimiter = {
  async beforeCall() {},
  onResponse() {},
  onError() {
    return { shouldRetry: false, delayMs: 0 };
  },
  reset() {},
  state() {
    return {
      requestsRemaining: undefined,
      tokensRemaining: undefined,
      requestsResetMs: undefined,
      tokensResetMs: undefined,
    };
  },
};

function scriptedModel(
  turns: LanguageModelV4StreamPart[][],
  promptCapture: LanguageModelV4Message[][],
): LanguageModelV4 {
  let call = 0;
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doStream(args: { prompt: LanguageModelV4Message[] }) {
      promptCapture.push(args.prompt.map((m) => ({ ...m })));
      const parts = turns[call] ?? [];
      call += 1;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModelV4;
}

function finishPart(reason: "tool-calls" | "stop"): LanguageModelV4StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  };
}

describe("phaseGenerate", () => {
  test("prompt cache options do not suppress temperature without reasoning", async () => {
    let capturedOptions: StreamOptions | undefined;
    const ctx = createRunContext({
      model: "openai/gpt-5-mini",
      reasoning: undefined,
      temperature: 0.42,
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream(_prompt, options) {
          capturedOptions = options;
          return {
            fullStream: new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "done", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(capturedOptions?.temperature).toBe(0.42);
    expect(capturedOptions?.providerOptions?.openai?.promptCacheKey).toBeString();
  });

  test("forwards the reasoning level as a call option and suppresses temperature", async () => {
    let capturedOptions: StreamOptions | undefined;
    const ctx = createRunContext({
      model: "anthropic/claude-opus-4-8",
      reasoning: "high",
      temperature: 0.42,
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream(_prompt, options) {
          capturedOptions = options;
          return {
            fullStream: new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "done", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(capturedOptions?.reasoning).toBe("high");
    // Reasoning models reject an explicit temperature, and the deprecated thinking
    // budget must never be assembled by hand.
    expect(capturedOptions?.temperature).toBeUndefined();
    expect(capturedOptions?.providerOptions?.anthropic).toBeUndefined();
  });

  test("passes Vercel AI Gateway prompt caching options", async () => {
    let capturedOptions: StreamOptions | undefined;
    const ctx = createRunContext({
      model: "vercel/anthropic/claude-sonnet-4",
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream(_prompt, options) {
          capturedOptions = options;
          return {
            fullStream: new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            async getFullOutput() {
              return { text: "done", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(capturedOptions?.providerOptions?.gateway).toEqual({ caching: "auto" });
    expect(capturedOptions?.providerOptions?.openai?.promptCacheKey).toBeString();
  });

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

  test("injects a recovery turn before finalizing an unresolved tool error", async () => {
    const debugEvents: LifecycleDebugEvent[] = [];
    let recoveryPrompt = "";
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "",
        model: {} as RunContext["agent"]["model"],
        tools: {},
        async stream(_prompt: string, options: StreamOptions) {
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
                  message: "Replace text is too large",
                  code: TOOL_ERROR_CODES.editFileReplaceTooLarge,
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
              await new Promise((resolve) => setTimeout(resolve, 0));
              const finishResult =
                options.onBeforeFinish?.({ messages: [], text: "Done.", answerText: "Done.", signal: "done" }) ?? [];
              const extras = Array.isArray(finishResult) ? finishResult : finishResult.messages;
              const textPart = extras[0]?.content[0];
              if (typeof textPart === "object" && textPart?.type === "text") recoveryPrompt = textPart.text;
              return { text: extras.length > 0 ? "Recovered." : "Done.", toolCalls: [], signal: "done" as const };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(recoveryPrompt).toContain('<system-reminder type="tool-error-recovery">');
    expect(recoveryPrompt).toContain("The previous `file-edit` call failed and remains unresolved.");
    expect(recoveryPrompt).toContain(`Error code: \`${TOOL_ERROR_CODES.editFileReplaceTooLarge}\`.`);
    expect(recoveryPrompt).toContain("Do not finalize yet.");
    expect(debugEvents.find((event) => event.event === "lifecycle.tool_error.recovery")?.fields).toMatchObject({
      tool: "file-edit",
      code: TOOL_ERROR_CODES.editFileReplaceTooLarge,
      action: "continue",
    });
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

  test("clears file-search no-match after later successful discovery recovery", async () => {
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
              payload: { toolCallId: "call_1", toolName: "file-search", args: { path: ".", pattern: "TODO" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                error: {
                  message: "No matches found in '.'.",
                  code: TOOL_ERROR_CODES.searchFilesNoMatch,
                },
              },
            },
            {
              type: "tool-call" as const,
              payload: { toolCallId: "call_2", toolName: "file-read", args: { path: "README.md" } },
            },
            {
              type: "tool-result" as const,
              payload: { toolCallId: "call_2", toolName: "file-read", result: { content: "# smoke\n" } },
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
              return { text: "", toolCalls: [], signal: "noop" as const };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(ctx.currentError).toBeUndefined();
    expect(resolveSignal(ctx)).toBe("noop");
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

  test("injects post-failure reminder when the last runner in callLog failed", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);
    const signalTools = createSignalToolkit({
      workspace: process.cwd(),
      session,
      onOutput: () => {},
      onChecklist: () => {},
    }) as unknown as Record<string, ToolDefinition>;

    // Turn 1: tool call (triggers onBeforeNextCall before turn 2)
    // Turn 2: done signal
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Done." },
        { type: "text-end", id: "t_1" },
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];

    const noopTool = {
      id: "noop",
      toolkit: "test",
      category: "execute" as const,
      description: "noop",
      instruction: "noop",
      inputSchema: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      outputSchema: { parse: (v: unknown) => v } as any,
      async execute() {
        return { result: { kind: "noop" } };
      },
    };

    const model = scriptedModel(turns, promptCapture);
    const tools = { noop: noopTool, ...signalTools };
    const agentStream = createAgentStream(model, "sys", tools, noopRateLimiter);

    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
      session,
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "sys",
        model: model as unknown as RunContext["agent"]["model"],
        tools,
        stream: agentStream,
      },
    });

    // Pre-populate callLog with a failed runner — R5 should fire before turn 2
    ctx.session.callLog.push({
      toolName: "test-run",
      args: { command: "bun test src/app.test.ts" },
      status: "failed",
      exitCode: 1,
    });

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    // The second model prompt should contain the post-failure system reminder
    const secondPrompt = promptCapture[1] ?? [];
    const injectedText = secondPrompt
      .filter((m) => m.role === "user")
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    expect(injectedText).toContain('type="post-failure');
    expect(injectedText).toContain("bun test src/app.test.ts");
    expect(debugEvents.find((e) => e.event === "lifecycle.reminders.injected")).toBeDefined();
  });

  test("blocks completion when the model never calls a signal tool", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);
    const signalTools = createSignalToolkit({
      workspace: process.cwd(),
      session,
      onOutput: () => {},
      onChecklist: () => {},
    }) as unknown as Record<string, ToolDefinition>;
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Done." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "Still done." },
        { type: "text-end", id: "t_2" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const agentStream = createAgentStream(model, "sys", signalTools, noopRateLimiter);
    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
      session,
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "sys",
        model: model as unknown as RunContext["agent"]["model"],
        tools: signalTools,
        stream: agentStream,
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    expect(promptCapture).toHaveLength(2);
    expect(promptCapture[1]).toContainEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: expect.stringContaining('type="missing-signal"'),
        },
      ],
    });
    expect(ctx.currentError).toMatchObject({ blocksCompletion: true });
    expect(ctx.result).toMatchObject({ text: "Still done.", toolCalls: [] });
    expect(debugEvents.filter((e) => e.event === "lifecycle.signal.missing").map((e) => e.fields?.action)).toEqual([
      "continue",
      "block",
    ]);
  });

  test("a missing signal followed by a valid done completes without error", async () => {
    // Regression (dogfood): the model answers without signalling, gets one nudge, then
    // calls signal_done — this must complete cleanly, not re-open the loop and block.
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);
    const signalTools = createSignalToolkit({
      workspace: process.cwd(),
      session,
      onOutput: () => {},
      onChecklist: () => {},
    }) as unknown as Record<string, ToolDefinition>;

    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Added the alias." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
      [
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];

    const model = scriptedModel(turns, promptCapture);
    const agentStream = createAgentStream(model, "sys", signalTools, noopRateLimiter);

    session.callLog.push({ toolName: "file-edit", args: { path: "src/app.ts" }, status: "succeeded" });
    session.callLog.push({ toolName: "test-run", args: { command: "bun test" }, status: "succeeded" });

    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Add a -v alias.", history: [] },
      debug: (event, fields) => debugEvents.push({ event, fields, sequence: debugEvents.length + 1, ts: "" }),
      session,
      agent: {
        id: "test-agent",
        name: "test-agent",
        instructions: "sys",
        model: model as unknown as RunContext["agent"]["model"],
        tools: signalTools,
        stream: agentStream,
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    expect(debugEvents.filter((e) => e.event === "lifecycle.signal.missing").map((e) => e.fields?.action)).toEqual([
      "continue",
    ]);
    expect(debugEvents.find((e) => e.event.startsWith("lifecycle.self_review"))).toBeUndefined();
    expect(ctx.currentError).toBeUndefined();
    expect(ctx.result?.signal).toBe("done");
  });
});
