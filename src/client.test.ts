import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote backend connection errors", () => {
  test("status surfaces a user-friendly backend-start hint on connection failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(backend.status()).rejects.toThrow(
      "Cannot reach server at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply maps socket-close fetch errors to backend-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("The socket connection was closed unexpectedly.");
    }) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow(
      "Cannot reach server at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply maps url-typo fetch errors to backend-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Was there a typo in the url or port?");
    }) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow(
      "Cannot reach server at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply preserves non-connection errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("boom");
  });

  test("reply surfaces timeout for hanging chat response", async () => {
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          return;
        }
        const abortError = new Error("aborted");
        if (signal.aborted) {
          reject(abortError);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(abortError);
          },
          { once: true },
        );
      });
    }) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767", replyTimeoutMs: 5 });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("Remote server reply timed out after 5ms");
  });

  test("reply surfaces backend error_id when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "model call failed",
          errorId: "err_abc12345",
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("Remote server error (502): model call failed [error_id=err_abc12345]");
  });

  test("reply ignores embedded progress payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "gpt-5-mini",
          output: "done",
          progressEvents: [
            {
              message: "Edited sum.rs",
              kind: "tool",
              toolCallId: "call_1",
              toolName: "edit-file",
              phase: "tool_start",
            },
            {
              message: "1 + fn draft() {}",
              kind: "tool",
              toolCallId: "call_1",
              toolName: "edit-file",
              phase: "tool_chunk",
            },
            {
              message: "Edited sum.rs",
              kind: "tool",
              toolCallId: "call_1",
              toolName: "edit-file",
              phase: "tool_end",
            },
            {
              message: "1 + fn main() {}",
              kind: "tool",
              toolCallId: "call_1",
              toolName: "edit-file",
              phase: "tool_end",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    const reply = await backend.reply({
      message: "ping",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
    });
    expect("progressEvents" in reply).toBe(false);
    expect("progressMessages" in reply).toBe(false);
  });

  test("replyStream emits stream events and returns final reply", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "tool-call",
                  toolCallId: "call_1",
                  toolName: "edit-file",
                  args: { path: "sum.rs" },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "done",
                  reply: {
                    model: "gpt-5-mini",
                    output: "done",
                  },
                })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    const received: Array<{ type: string; toolName?: string }> = [];
    const reply = await backend.replyStream(
      {
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      },
      {
        onEvent: (event) => {
          if (event.type === "tool-call") {
            received.push({ type: event.type, toolName: event.toolName });
          }
        },
      },
    );

    expect(received).toEqual([{ type: "tool-call", toolName: "edit-file" }]);
    expect(reply.output).toBe("done");
    expect(reply.model).toBe("gpt-5-mini");
  });

  test("replyStream skips malformed SSE blocks without crashing", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("data: {not valid json}\n\n"));
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "done",
                  reply: { model: "gpt-5-mini", output: "ok" },
                })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    const reply = await backend.replyStream(
      { message: "ping", history: [], model: "gpt-5-mini", sessionId: "sess_test" },
      { onEvent: () => {} },
    );
    expect(reply.output).toBe("ok");
  });

  test("replyStream surfaces stream error event", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  error: "Provider quota exceeded",
                })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        {
          onEvent: () => {},
        },
      ),
    ).rejects.toThrow("Provider quota exceeded");
  });
});

describe("remote backend status parsing", () => {
  test("status extracts flat string fields from response", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          provider: "openai",
          model: "gpt-5-mini",
          permissions: "write",
          service: "http://localhost:6767",
          memory: "postgres (4 entries)",
          observational_memory: "enabled (resource)",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      permissions: "write",
      service: "http://localhost:6767",
      memory: "postgres (4 entries)",
      observational_memory: "enabled (resource)",
    });
  });

  test("status skips ok and non-string fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          provider: "mock",
          model: "gpt-5-mini",
          extra_number: 42,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createClient({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toEqual({
      provider: "mock",
      model: "gpt-5-mini",
    });
  });
});

describe("createClient", () => {
  test("throws when no apiUrl is configured", () => {
    expect(() => createClient({ apiUrl: "" })).toThrow("No API URL configured");
  });
});
