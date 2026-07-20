import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createAgentStream } from "./agent-stream";
import type { StreamEvent } from "./client-contract";
import type { RunContext } from "./lifecycle-contract";
import type { RateLimiter } from "./rate-limiter";
import { createRunContext } from "./test-utils";
import type { ToolDefinition } from "./tool-contract";
import type { ToolOutputListener } from "./tool-output-format";

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

function scriptedModel(turns: LanguageModelV4StreamPart[][]): LanguageModelV4 {
  let call = 0;
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doStream() {
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

const finish = (reason: "tool-calls" | "stop"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
});
const delta = (text: string): LanguageModelV4StreamPart => ({ type: "text-delta", id: "t", delta: text }) as never;

describe("real emit order (single ordered channel)", () => {
  test("a tool-output raised during execute is ordered against its tool-call and tool-result", async () => {
    const events: StreamEvent[] = [];
    const emit = (e: StreamEvent) => events.push(e);

    // The tool raises output the way a real toolkit does: through the injected onOutput sink,
    // which lifecycle wires to `ctx.sideEffectSink`. It must never reach the client via a side
    // channel that jumps the ordered fullStream.
    let ctxRef: RunContext | undefined;
    const onOutput: ToolOutputListener = (event) => ctxRef?.sideEffectSink?.({ type: "tool-output", ...event });
    // skill-activate raises an output row then a skill-activated event, both mid-execute — the
    // same shape real toolkits use. Every one must ride the ordered stream.
    const tool: ToolDefinition = {
      id: "skill-activate",
      description: "d",
      parameters: { type: "object", properties: {} },
      execute: async (_args: unknown, toolCallId: string) => {
        onOutput({
          toolName: "skill-activate",
          content: { kind: "tool-header", labelKey: "tool.label.skill_activate", detail: "acolyte", state: "on" },
          toolCallId,
        });
        ctxRef?.sideEffectSink?.({ type: "skill-activated", skill: { name: "acolyte", instructions: "x" } });
        return { result: { kind: "skill-activate", activated: [] } };
      },
    } as unknown as ToolDefinition;

    const narration = Array.from({ length: 12 }, (_, i) => delta(`word${i} `));
    const agent = {
      id: "a",
      name: "a",
      instructions: "",
      model: {} as never,
      tools: {},
      stream: createAgentStream(
        scriptedModel([
          [
            ...narration,
            { type: "tool-call", toolCallId: "tc1", toolName: "skill-activate", input: "{}" } as never,
            finish("tool-calls"),
          ],
          [delta("The answer prose."), finish("stop")],
        ]),
        "instructions",
        { "skill-activate": tool },
        noopRateLimiter,
      ),
    } as never;

    const { phaseGenerate } = await import("./lifecycle-generate");
    const ctx = createRunContext({ emit, agent, session: (await import("./tool-session")).createSessionContext() });
    ctxRef = ctx;
    await phaseGenerate(ctx, { timeoutMs: 2000 });

    const seq = events.map((e) => e.type);
    const toolCall = seq.indexOf("tool-call");
    const toolOutput = seq.indexOf("tool-output");
    const skillActivated = seq.indexOf("skill-activated");
    const toolResult = seq.indexOf("tool-result");
    const narrationBeforeToolCall = seq.slice(0, toolCall).filter((t) => t === "text-delta").length;

    expect(toolCall).toBeGreaterThan(-1);
    expect(toolOutput).toBeGreaterThan(-1);
    expect(skillActivated).toBeGreaterThan(-1);
    expect(toolResult).toBeGreaterThan(-1);
    // Every event raised mid-execute belongs to its tool call: after the tool-call that spawned
    // it, before its result. It holds for output rows and skill lifecycle events alike.
    expect(toolOutput).toBeGreaterThan(toolCall);
    expect(toolOutput).toBeLessThan(toolResult);
    expect(skillActivated).toBeGreaterThan(toolCall);
    expect(skillActivated).toBeLessThan(toolResult);
    // Step-1 narration lands whole before the tool-call, so no output row splits the prose.
    expect(narrationBeforeToolCall).toBe(narration.length);
  });
});
