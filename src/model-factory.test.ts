import { describe, expect, test } from "bun:test";
import type { LanguageModelV4Message } from "@ai-sdk/provider";
import type { ProviderCredentialsMap } from "./agent-model";
import { createModel } from "./model-factory";
import { sharedRateLimiter } from "./rate-limiter";

describe("createModel anthropic reasoning", () => {
  function minimalStreamResponse(): Response {
    const body =
      "event: message_start\n" +
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-4-8","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n' +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n' +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n\n';
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  async function captureRequestBody(modelId: string, reasoning: "low" | "medium" | "high") {
    const originalFetch = globalThis.fetch;
    let captured: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return minimalStreamResponse();
    }) as typeof globalThis.fetch;

    try {
      const credentials: ProviderCredentialsMap = { anthropic: { apiKey: "test-key" } };
      const model = createModel(modelId, sharedRateLimiter("anthropic"), credentials);
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] as LanguageModelV4Message[],
        reasoning,
      });
      const reader = stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      return captured;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  test("maps reasoning to adaptive thinking on current models, never a budget", async () => {
    const body = await captureRequestBody("anthropic/claude-opus-4-8", "high");
    expect(body?.thinking).toEqual({ type: "adaptive" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(body?.output_config).toMatchObject({ effort: "high" });
  });

  test("maps the reasoning level onto the effort knob", async () => {
    const body = await captureRequestBody("anthropic/claude-opus-4-8", "low");
    expect(body?.thinking).toEqual({ type: "adaptive" });
    expect(body?.output_config).toMatchObject({ effort: "low" });
  });
});
