import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4Message, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { StreamChunk } from "./agent-contract";
import { createAgentStream } from "./agent-stream";
import type { RateLimiter } from "./rate-limiter";
import type { ToolDefinition } from "./tool-contract";

describe("tool results are retained verbatim across steps", () => {
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

  function finishPart(reason: "tool-calls" | "stop" | "length"): LanguageModelV4StreamPart {
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
  ): LanguageModelV4 {
    let call = 0;
    return {
      specificationVersion: "v3",
      provider: "test",
      modelId: "test-model",
      supportedUrls: {},
      async doStream(args: { prompt: LanguageModelV4Message[] } & Record<string, unknown>) {
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

  function markerTool(marker: string): ToolDefinition {
    let call = 0;
    return {
      id: "run-cmd",
      toolkit: "test",
      category: "execute",
      description: "run",
      instruction: "run",
      inputSchema: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      outputSchema: { parse: (v: unknown) => v } as any,
      async execute() {
        call += 1;
        // Per-call marker so the positive assertion pins the step-1 result specifically,
        // independent of the placeholder string the old compaction used.
        return { result: { kind: "run-cmd", marker: `${marker}-${call}` } };
      },
    };
  }

  test("a step-1 tool result is still visible verbatim at the step-3 model call", async () => {
    // Regression for the removed microcompaction: it rewrote every prior non-file-read
    // tool result to "[previous tool result]" after one step, so the model re-ran
    // commands (verify/test) whose output it could no longer see.
    const marker = "RUN-OUTPUT-MARKER";
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "run-cmd", input: "{}" }, finishPart("tool-calls")],
      [{ type: "tool-call", toolCallId: "tc_2", toolName: "run-cmd", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "done" },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { "run-cmd": markerTool(marker) }, noopRateLimiter);
    const { getFullOutput } = await stream("run verify", {});
    await getFullOutput();

    expect(promptCapture.length).toBe(3);
    const thirdPrompt = JSON.stringify(promptCapture[2]);
    expect(thirdPrompt).toContain(`${marker}-1`);
    expect(thirdPrompt).toContain(`${marker}-2`);
    expect(thirdPrompt).not.toContain("[previous tool result]");
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

  function finishPart(reason: "tool-calls" | "stop" | "length"): LanguageModelV4StreamPart {
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
    // Native contract: a completion is a no-tool-call step. A rejection reopens the loop; on the
    // reopen the just-written assistant text is pushed so the nudge has context.
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Premature." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "Validated." },
        { type: "text-end", id: "t_2" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);

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
    expect(promptCapture).toHaveLength(2);
    const secondPrompt = promptCapture[1];
    expect(secondPrompt).toContainEqual({ role: "assistant", content: [{ type: "text", text: "Premature." }] });
    expect(secondPrompt).toContainEqual({ role: "user", content: [{ type: "text", text: "<<finish-rejected>>" }] });
  });

  test("the final onBeforeFinish sees the same answerText that getFullOutput returns", async () => {
    // Divergence pin: the in-stream completion gate reads `answerText`, and it is the sole
    // enforcement of the retry-spent block. If result assembly ever stopped returning
    // `text: answerText`, the gate would judge different text than the run resolves to.
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Premature." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "Validated answer." },
        { type: "text-end", id: "t_2" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);

    const seenAnswerText: string[] = [];
    let rejected = false;
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: ({ answerText }) => {
        seenAnswerText.push(answerText);
        if (rejected) return [];
        rejected = true;
        return [{ role: "user", content: [{ type: "text", text: "<<finish-rejected>>" }] }];
      },
    });
    const output = await getFullOutput();

    expect(seenAnswerText).toHaveLength(2);
    expect(seenAnswerText[seenAnswerText.length - 1]).toBe(output.text);
    expect(output.text).toBe("Validated answer.");
  });

  test("an empty-answer reopen does not seed the retry call with an empty text block", async () => {
    // Providers (Anthropic) reject empty text content blocks. The empty-answer backstop reopens
    // on a blank no-tool-call step, so it must not push that blank stepText — otherwise the sole
    // completion backstop 400s on the retry instead of nudging the model to answer.
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [finishPart("stop")],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "Validated answer." },
        { type: "text-end", id: "t_2" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);

    let rejected = false;
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: () => {
        if (rejected) return [];
        rejected = true;
        return [{ role: "user", content: [{ type: "text", text: "<<finish-rejected>>" }] }];
      },
    });
    const output = await getFullOutput();

    expect(output.text).toBe("Validated answer.");
    expect(promptCapture.length).toBe(2);
    expect(JSON.stringify(promptCapture[1])).not.toContain('"text":""');
  });

  test("a turn with tool work terminates via the no-tool-call step", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "The answer is 42." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);
    const { getFullOutput } = await stream("hi", {});
    const output = await getFullOutput();

    expect(output.text).toBe("The answer is 42.");
    expect(output.toolCalls.map((call) => call.toolName)).toEqual(["noop"]);
  });

  test("narration on a tool-calling step never becomes the answer", async () => {
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
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);
    const { getFullOutput } = await stream("hi", {});
    const output = await getFullOutput();

    expect(output.text).toBe("x is 2.");
  });

  test("a no-tool-call step with no text yields empty result text", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [[finishPart("stop")]];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);
    const { getFullOutput } = await stream("hi", {});
    const output = await getFullOutput();

    expect(output.text).toBe("");
  });

  test("a degenerate tool-calling step with a non-tool-calls finish reason runs the backstop", async () => {
    // The model emitted tool calls but finished with "stop" — terminate and run onBeforeFinish
    // rather than silently breaking or looping forever.
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "narration" },
        { type: "text-end", id: "t_1" },
        { type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);

    let sawFinish = false;
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: () => {
        sawFinish = true;
        return [];
      },
    });
    const output = await getFullOutput();

    expect(sawFinish).toBe(true);
    expect(output.toolCalls.map((call) => call.toolName)).toEqual(["noop"]);
    // Text alongside tool calls is narration, not the answer.
    expect(output.text).toBe("");
  });

  test("a truncated answer is stitched across a continuation, not replaced by the tail", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "First half " },
        { type: "text-end", id: "t_1" },
        finishPart("length"),
      ],
      [
        { type: "text-start", id: "t_2" },
        { type: "text-delta", id: "t_2", delta: "second half." },
        { type: "text-end", id: "t_2" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", {}, noopRateLimiter);

    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: ({ finishReason }) =>
        finishReason === "length" ? [{ role: "user", content: [{ type: "text", text: "<<continue>>" }] }] : [],
    });
    const output = await getFullOutput();

    expect(output.text).toBe("First half second half.");
    expect(promptCapture[1]).toContainEqual({ role: "assistant", content: [{ type: "text", text: "First half " }] });
  });

  test("a length cutoff mid-tool-call surfaces as truncated, not empty-answer", async () => {
    const promptCapture: LanguageModelV4Message[][] = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("length")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "Answer." },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, promptCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);

    const seen: Array<{ finishReason?: string; answerText: string }> = [];
    const { getFullOutput } = await stream("hi", {
      onBeforeFinish: ({ finishReason, answerText }) => {
        seen.push({ finishReason, answerText });
        return finishReason === "length" ? [{ role: "user", content: [{ type: "text", text: "<<continue>>" }] }] : [];
      },
    });
    const output = await getFullOutput();

    // The gate sees a length cutoff with blank answer text — enough to classify it truncated
    // rather than empty-answer — and the tool-step narration never pollutes the stitched answer.
    expect(seen[0]).toEqual({ finishReason: "length", answerText: "" });
    expect(output.text).toBe("Answer.");
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

  test("the model call always uses auto tool choice", async () => {
    const argsCapture: Array<Record<string, unknown>> = [];
    const turns: LanguageModelV4StreamPart[][] = [
      [{ type: "tool-call", toolCallId: "tc_1", toolName: "noop", input: "{}" }, finishPart("tool-calls")],
      [
        { type: "text-start", id: "t_1" },
        { type: "text-delta", id: "t_1", delta: "done" },
        { type: "text-end", id: "t_1" },
        finishPart("stop"),
      ],
    ];
    const model = scriptedModel(turns, [], argsCapture);
    const stream = createAgentStream(model, "sys", { noop: echoTool() }, noopRateLimiter);
    await stream("hi", {}).then(({ getFullOutput }) => getFullOutput());

    expect(argsCapture[0]?.toolChoice).toEqual({ type: "auto" });
    expect(argsCapture[1]?.toolChoice).toEqual({ type: "auto" });
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
