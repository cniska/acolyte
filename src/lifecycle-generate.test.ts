import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4Message, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { StreamOptions } from "./agent-contract";
import { createAgentStream } from "./agent-stream";
import type { StreamEvent } from "./client-contract";
import { TOOL_ERROR_CODES } from "./error-contract";
import type { LifecycleDebugEvent, RunContext } from "./lifecycle-contract";
import { phaseGenerate } from "./lifecycle-generate";
import type { RateLimiter } from "./rate-limiter";
import { createRunContext } from "./test-utils";
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
  argsCapture?: Array<Record<string, unknown>>,
): LanguageModelV4 {
  let call = 0;
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doStream(args: { prompt: LanguageModelV4Message[]; toolChoice?: unknown }) {
      promptCapture.push(args.prompt.map((m) => ({ ...m })));
      argsCapture?.push(args);
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

  test("a no-match search does not gate the turn", async () => {
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
              payload: { toolCallId: "call_1", toolName: "file-search", args: { path: ".", pattern: "TODO" } },
            },
            {
              type: "tool-error" as const,
              payload: {
                toolCallId: "call_1",
                toolName: "file-search",
                error: { message: "No matches found in '.'.", code: TOOL_ERROR_CODES.searchFilesNoMatch },
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
              return { text: "No TODOs found.", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    // A no-match search is a normal result, not a broken run: it neither sets a
    // run-level error nor injects a recovery turn.
    expect(ctx.currentError).toBeUndefined();
    expect(debugEvents.some((event) => event.event === "lifecycle.tool_error.recovery")).toBe(false);
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
              return { text: "Done.", toolCalls: [] };
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
              return { text: "Done.", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    // A nonzero exit is marked failed for the UI/trace but is not a run-level error:
    // it must not populate ctx.currentError (a red exit is often the answer — e.g.
    // "diagnose why this test fails").
    expect(ctx.currentError).toBeUndefined();
    const traceResult = debugEvents.find((event) => event.event === "lifecycle.tool.result");
    expect(traceResult?.fields).toMatchObject({ tool: "test-run", is_error: true });
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
    // A run-level (generate) error blocks completion, unlike a tool error.
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
              return { text: "Done.", toolCalls: [] };
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
              return { text: "Done.", toolCalls: [] };
            },
          };
        },
      },
    });

    await phaseGenerate(ctx, { timeoutMs: 1000 });

    expect(ctx.promptUsage.memoryTokens).toBe(0);
  });

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

  test("injects post-failure reminder when the last runner in callLog failed", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);

    // Turn 1: tool call (triggers onBeforeNextCall before turn 2).
    // Turn 2: native no-tool-call final response.
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Done." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];

    const model = scriptedModel(turns, promptCapture);
    const tools = { noop: noopTool };
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

    // Pre-populate callLog with a failed runner — the post-failure reminder fires before turn 2.
    ctx.session.callLog.push({
      toolName: "test-run",
      args: { command: "bun test src/app.test.ts" },
      status: "failed",
      exitCode: 1,
    });

    await phaseGenerate(ctx, { timeoutMs: 5000 });

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

  test("empty-answer: tool work then a blank final response is nudged once, then blocks", async () => {
    // Regression (dogfood): a turn that does tool work then ends its turn with no final
    // response gets one nudge; if it ends blank again, the completion gate errors the run
    // rather than surfacing an empty answer.
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);

    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [finishPart("stop")],
      [finishPart("stop")],
    ];

    const model = scriptedModel(turns, promptCapture);
    const tools = { noop: noopTool };
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

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    expect(ctx.currentError).toMatchObject({ blocksCompletion: true });
    // The terminal error is user-audience, never the model-facing "you ended your turn…" nudge.
    expect(ctx.currentError?.message).toBe(
      "The agent finished without writing a response. Retry or rephrase the request.",
    );
    expect(ctx.currentError?.message).not.toContain("you ended your turn");
    expect(debugEvents.filter((e) => e.event === "lifecycle.completion.rejected").map((e) => e.fields?.action)).toEqual(
      ["continue", "block"],
    );
  });

  test("a written final response after tool work completes cleanly", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const debugEvents: LifecycleDebugEvent[] = [];
    const session = createSessionContext(undefined, WRITE_TOOL_SET);

    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Added the alias." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];

    const model = scriptedModel(turns, promptCapture);
    const tools = { noop: noopTool };
    const agentStream = createAgentStream(model, "sys", tools, noopRateLimiter);

    const ctx = createRunContext({
      request: { model: "gpt-5-mini", message: "Add a -v alias.", history: [] },
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

    await phaseGenerate(ctx, { timeoutMs: 5000 });

    expect(ctx.currentError).toBeUndefined();
    expect(ctx.result?.text).toBe("Added the alias.");
    expect(debugEvents.some((e) => e.event === "lifecycle.completion.rejected")).toBe(false);
  });
});
