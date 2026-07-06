import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4Message, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { StreamChunk } from "./agent-contract";
import { COMPACTED_OUTPUT, compactPriorToolResults, createAgentStream } from "./agent-stream";
import type { RateLimiter } from "./rate-limiter";
import type { ToolDefinition } from "./tool-contract";

describe("compactPriorToolResults", () => {
  function toolMsg(results: Array<{ id: string; name: string; value: string }>): LanguageModelV4Message {
    return {
      role: "tool",
      content: results.map((r) => ({
        type: "tool-result" as const,
        toolCallId: r.id,
        toolName: r.name,
        output: { type: "text" as const, value: r.value },
      })),
    };
  }

  test("replaces tool result output with compact marker", () => {
    const messages: LanguageModelV4Message[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: [{ type: "text", text: "search for foo" }] },
      toolMsg([{ id: "tc_1", name: "file-search", value: "hit:\n".repeat(500) }]),
    ];
    compactPriorToolResults(messages);
    const tool = messages[2];
    expect(tool.role).toBe("tool");
    if (tool.role !== "tool") throw new Error("unexpected");
    const part = tool.content[0];
    expect(part.type).toBe("tool-result");
    if (part.type !== "tool-result") throw new Error("unexpected");
    expect(part.output).toEqual(COMPACTED_OUTPUT);
    expect(part.toolCallId).toBe("tc_1");
    expect(part.toolName).toBe("file-search");
  });

  test("skips non-tool messages", () => {
    const systemContent = "you are helpful";
    const messages: LanguageModelV4Message[] = [
      { role: "system", content: systemContent },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    compactPriorToolResults(messages);
    expect(messages[0]).toEqual({ role: "system", content: systemContent });
    expect(messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
  });

  test("compacts multiple tool messages", () => {
    const messages: LanguageModelV4Message[] = [
      { role: "system", content: "sys" },
      toolMsg([{ id: "tc_1", name: "file-search", value: "hit1" }]),
      toolMsg([{ id: "tc_2", name: "file-search", value: "hit2" }]),
    ];
    compactPriorToolResults(messages);
    for (const msg of messages.filter((m) => m.role === "tool")) {
      if (msg.role !== "tool") continue;
      for (const part of msg.content) {
        if (part.type !== "tool-result") continue;
        expect(part.output).toEqual(COMPACTED_OUTPUT);
      }
    }
  });

  test("preserves file-read results across compaction", () => {
    const fileContent = "File: src/foo.ts\n1: const x = 1;\n2: const y = 2;\n";
    const messages: LanguageModelV4Message[] = [
      toolMsg([{ id: "tc_1", name: "file-read", value: fileContent }]),
      toolMsg([{ id: "tc_2", name: "file-search", value: "hits" }]),
    ];
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    const readPart = messages[0].content[0];
    if (readPart.type !== "tool-result") throw new Error("unexpected");
    expect(readPart.output).toEqual({ type: "text", value: fileContent });
    if (messages[1].role !== "tool") throw new Error("unexpected");
    const searchPart = messages[1].content[0];
    if (searchPart.type !== "tool-result") throw new Error("unexpected");
    expect(searchPart.output).toEqual(COMPACTED_OUTPUT);
  });

  test("compacts multiple results within a single tool message", () => {
    const messages: LanguageModelV4Message[] = [
      toolMsg([
        { id: "tc_1", name: "file-search", value: "content1" },
        { id: "tc_2", name: "shell-exec", value: "output2" },
      ]),
    ];
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    expect(messages[0].content).toHaveLength(2);
    for (const part of messages[0].content) {
      if (part.type !== "tool-result") continue;
      expect(part.output).toEqual(COMPACTED_OUTPUT);
    }
  });

  test("is idempotent", () => {
    const messages: LanguageModelV4Message[] = [toolMsg([{ id: "tc_1", name: "file-search", value: "content" }])];
    compactPriorToolResults(messages);
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    const part = messages[0].content[0];
    if (part.type !== "tool-result") throw new Error("unexpected");
    expect(part.output).toEqual(COMPACTED_OUTPUT);
  });
});

describe("onBeforeNextCall hook", () => {
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
      async doStream(args: { prompt: LanguageModelV4Message[] } & Record<string, unknown>) {
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

  function echoTool(): ToolDefinition {
    return {
      id: "noop",
      toolkit: "test",
      category: "execute",
      description: "noop",
      instruction: "noop",
      inputSchema: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      outputSchema: { parse: (v: unknown) => v } as any,
      async execute() {
        return { result: { kind: "noop" } };
      },
    };
  }

  function signalDoneTool(): ToolDefinition {
    return {
      id: "signal_done",
      toolkit: "signal",
      category: "meta",
      description: "done",
      instruction: "done",
      inputSchema: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      outputSchema: { parse: (v: unknown) => v } as any,
      async execute() {
        return { result: { kind: "lifecycle-signal", signal: "done" } };
      },
    };
  }

  test("injects returned messages into the next model prompt", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "done" },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);

    const marker = "<<inject-test-marker>>";
    const { getFullOutput } = await stream("hi", {
      onBeforeNextCall: () => [{ role: "user", content: [{ type: "text", text: marker }] }],
    });
    await getFullOutput();

    expect(promptCapture.length).toBeGreaterThanOrEqual(2);
    const secondPrompt = promptCapture[1];
    const injected = secondPrompt.find(
      (m) =>
        m.role === "user" && Array.isArray(m.content) && m.content.some((p) => p.type === "text" && p.text === marker),
    );
    expect(injected).toBeTruthy();
  });

  test("skips injection when hook is not provided", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [[finishPart("stop")]];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);
    const { getFullOutput } = await stream("hi", {});
    await getFullOutput();
    expect(promptCapture.length).toBe(1);
  });

  test("continues when onBeforeFinish rejects a completion attempt", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Premature." },
        { type: "text-end", id: "t_1" },
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "Validated." },
        { type: "text-end", id: "t_2" },
        { type: "tool-call", toolCallId: "tc_signal_2", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { signal_done: signalDoneTool() }, noopRateLimiter);

    let rejected = false;
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: () => {
        if (rejected) return [];
        rejected = true;
        return [{ role: "user", content: [{ type: "text", text: "<<finish-rejected>>" }] }];
      },
    });
    const output = await getFullOutput();

    expect(output.text).toBe("Validated.");
    expect(output.signal).toBe("done");
    expect(output.toolCalls.map((call) => call.toolName)).toEqual(["signal_done", "signal_done"]);
    expect(promptCapture).toHaveLength(2);
    const secondPrompt = promptCapture[1];
    expect(secondPrompt).toContainEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Premature." },
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: {} },
      ],
    });
    expect(secondPrompt).toContainEqual({ role: "user", content: [{ type: "text", text: "<<finish-rejected>>" }] });
  });

  test("returns the answer when a nudged text step is followed by a bare signal", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "The answer is 42." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
      [
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { signal_done: signalDoneTool() }, noopRateLimiter);

    let nudged = false;
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: () => {
        if (nudged) return [];
        nudged = true;
        return [{ role: "user", content: [{ type: "text", text: "<<signal to finish>>" }] }];
      },
    });
    const output = await getFullOutput();

    expect(output.text).toBe("The answer is 42.");
    expect(output.signal).toBe("done");
  });

  test("the final answer supersedes earlier tool-step narration", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Checking file." },
        { type: "text-end", id: "t_1" },
        { type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" },
        finishPart("tool-calls"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "x is 2." },
        { type: "text-end", id: "t_2" },
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(
      model,
      "sys",
      { noop: echoTool(), signal_done: signalDoneTool() },
      noopRateLimiter,
    );
    const { getFullOutput } = await stream("hi", {});
    const output = await getFullOutput();

    expect(output.text).toBe("x is 2.");
  });

  test("a bare signal with no text yields empty result text", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "tool-call", toolCallId: "tc_signal_1", toolName: "signal_done", input: "{}" },
        finishPart("tool-calls"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { signal_done: signalDoneTool() }, noopRateLimiter);
    const { getFullOutput } = await stream("hi", {});
    const output = await getFullOutput();

    expect(output.text).toBe("");
    expect(output.signal).toBe("done");
  });

  test("passes the reasoning level through to the model as a call option", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const argsCapture: Array<Record<string, unknown>> = [];
    const turns: LanguageModelV4StreamPart[][] = [[finishPart("stop")]];
    const model = scriptedModel(turns, promptCapture, argsCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);
    const { getFullOutput } = await stream("hi", { reasoning: "high" });
    await getFullOutput();

    expect(argsCapture).toHaveLength(1);
    expect(argsCapture[0].reasoning).toBe("high");
    // Reasoning must ride the unified call option, never a hand-built thinking budget.
    expect(argsCapture[0].providerOptions).toBeUndefined();
  });

  test("replays reasoning blocks with their signature alongside the tool call", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "reasoning-start", id: "r_1" },
        { type: "reasoning-delta", id: "r_1", delta: "Weighing options." },
        // Anthropic delivers the thinking-block signature on a zero-length delta.
        { type: "reasoning-delta", id: "r_1", delta: "", providerMetadata: { anthropic: { signature: "sig-abc" } } },
        { type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" },
        finishPart("tool-calls"),
      ],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "done" },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);
    const { getFullOutput } = await stream("hi", { reasoning: "high" });
    await getFullOutput();

    const secondPrompt = promptCapture[1];
    expect(secondPrompt).toContainEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "Weighing options.", providerOptions: { anthropic: { signature: "sig-abc" } } },
        { type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: {} },
      ],
    });
  });

  test("emits cache and reasoning token counts from the finish part", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 100, noCache: 40, cacheRead: 60, cacheWrite: 10 },
            outputTokens: { total: 20, text: 12, reasoning: 8 },
          },
        },
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);
    const { fullStream, getFullOutput } = await stream("hi", {});

    const chunks: StreamChunk[] = [];
    const reader = fullStream.getReader();
    const drain = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    })();
    await getFullOutput();
    await drain;

    const usage = chunks.find((c) => c.type === "model-usage");
    if (usage?.type !== "model-usage") throw new Error("no model-usage chunk emitted");
    expect(usage.payload).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 60,
      cacheWriteTokens: 10,
      reasoningTokens: 8,
    });
  });
});
