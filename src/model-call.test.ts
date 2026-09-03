import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { embedModelCall, streamModelCall } from "./model-call";
import { createRateLimiter, type RateLimiter } from "./rate-limiter";

function limiter(): RateLimiter {
  return createRateLimiter({ backoffBaseMs: 0, backoffMaxMs: 0 });
}

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error(`http ${status}`), { status });
}

function partsStream(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** A model whose call fails with the queued errors, then succeeds. */
function flakyModel(errors: unknown[], parts: LanguageModelV4StreamPart[] = []) {
  let attempts = 0;
  const client = {
    doStream: async () => {
      attempts += 1;
      const error = errors.shift();
      if (error) throw error;
      return { stream: partsStream(parts) };
    },
  } as unknown as LanguageModelV4;
  return {
    client,
    attempts: () => attempts,
  };
}

async function drain(stream: ReadableStream<LanguageModelV4StreamPart>): Promise<LanguageModelV4StreamPart[]> {
  const reader = stream.getReader();
  const parts: LanguageModelV4StreamPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

describe("streamModelCall", () => {
  test("retries an overloaded provider and returns the eventual stream", async () => {
    const model = flakyModel([statusError(529)], [{ type: "text-delta", id: "1", delta: "hi" }]);
    const result = await streamModelCall({ client: model.client, limiter: limiter(), request: { prompt: [] } });
    expect(await drain(result.stream)).toHaveLength(1);
    expect(model.attempts()).toBe(2);
  });

  test("retries a rate limit, which the distiller never did", async () => {
    const model = flakyModel([statusError(429)]);
    await streamModelCall({ client: model.client, limiter: limiter(), request: { prompt: [] } });
    expect(model.attempts()).toBe(2);
  });

  test("gives up after the attempt budget and throws the provider's own error", async () => {
    const model = flakyModel([statusError(529), statusError(529), statusError(529)]);
    const call = streamModelCall({
      client: model.client,
      limiter: limiter(),
      request: { prompt: [] },
      maxAttempts: 2,
    });
    await expect(call).rejects.toThrow("http 529");
    expect(model.attempts()).toBe(2);
  });

  test("does not retry an error repeating the call cannot fix", async () => {
    const model = flakyModel([statusError(400)]);
    await expect(
      streamModelCall({ client: model.client, limiter: limiter(), request: { prompt: [] } }),
    ).rejects.toThrow("http 400");
    expect(model.attempts()).toBe(1);
  });

  test("aborts a stream that goes idle past its deadline, rather than hanging", async () => {
    const client = {
      doStream: async () => ({
        // A connection that opened and then stopped delivering: what a machine sleeping mid-call
        // leaves behind. Without an idle deadline the read below never settles.
        stream: new ReadableStream<LanguageModelV4StreamPart>({ start() {} }),
      }),
    } as unknown as LanguageModelV4;
    const result = await streamModelCall({
      client,
      limiter: limiter(),
      request: { prompt: [] },
      idleTimeoutMs: 20,
    });
    await expect(drain(result.stream)).rejects.toThrow(/idle/i);
  });

  test("a stream that keeps delivering is never cut off by the idle deadline", async () => {
    const client = {
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            for (let i = 0; i < 4; i++) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              controller.enqueue({ type: "text-delta", id: String(i), delta: "x" });
            }
            controller.close();
          },
        }),
      }),
    } as unknown as LanguageModelV4;
    const result = await streamModelCall({
      client,
      limiter: limiter(),
      request: { prompt: [] },
      idleTimeoutMs: 60,
    });
    expect(await drain(result.stream)).toHaveLength(4);
  });

  test("hands the caller's own signal to the provider, not a copy of it", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const client = {
      doStream: async (options: { abortSignal?: AbortSignal }) => {
        seen = options.abortSignal;
        return { stream: partsStream([]) };
      },
    } as unknown as LanguageModelV4;
    await streamModelCall({
      client,
      limiter: limiter(),
      request: { prompt: [] },
      abortSignal: controller.signal,
    });
    expect(seen).toBe(controller.signal);
  });

  test("embeds through the same retry, so a blip cannot leave a memory unsearchable", async () => {
    let attempts = 0;
    const client = {
      doEmbed: async () => {
        attempts += 1;
        if (attempts < 3) throw statusError(429);
        return { embeddings: [[0.1, 0.2]] };
      },
    } as unknown as Parameters<typeof embedModelCall>[0]["client"];
    const embeddings = await embedModelCall({ client, limiter: limiter(), values: ["a fact"] });
    expect(embeddings).toEqual([[0.1, 0.2]]);
    expect(attempts).toBe(3);
  });

  test("an embedding call gives up on an error a retry cannot fix", async () => {
    let attempts = 0;
    const client = {
      doEmbed: async () => {
        attempts += 1;
        throw statusError(401);
      },
    } as unknown as Parameters<typeof embedModelCall>[0]["client"];
    await expect(embedModelCall({ client, limiter: limiter(), values: ["a fact"] })).rejects.toThrow("http 401");
    expect(attempts).toBe(1);
  });

  test("an embedding call carries a deadline so it cannot hang", async () => {
    let seen: AbortSignal | undefined;
    const client = {
      doEmbed: async (options: { abortSignal?: AbortSignal }) => {
        seen = options.abortSignal;
        return { embeddings: [[0]] };
      },
    } as unknown as Parameters<typeof embedModelCall>[0]["client"];
    await embedModelCall({ client, limiter: limiter(), values: ["a fact"] });
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  test("passes no signal when the caller gave none", async () => {
    let seen: unknown = "unset";
    const client = {
      doStream: async (options: { abortSignal?: AbortSignal }) => {
        seen = options.abortSignal;
        return { stream: partsStream([]) };
      },
    } as unknown as LanguageModelV4;
    await streamModelCall({ client, limiter: limiter(), request: { prompt: [] } });
    expect(seen).toBeUndefined();
  });
});
