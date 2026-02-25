import { afterEach, describe, expect, test } from "bun:test";
import { createBackend } from "./backend";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote backend connection errors", () => {
  test("status surfaces a user-friendly backend-start hint on connection failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(backend.status()).rejects.toThrow(
      "Cannot reach backend at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply maps socket-close fetch errors to backend-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("The socket connection was closed unexpectedly.");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow(
      "Cannot reach backend at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply maps url-typo fetch errors to backend-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Was there a typo in the url or port?");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow(
      "Cannot reach backend at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply preserves non-connection errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
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

    const backend = createBackend({ apiUrl: "http://localhost:6767", replyTimeoutMs: 5 });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("Remote backend reply timed out after 5ms");
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

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("Remote backend error (502): model call failed [error_id=err_abc12345]");
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

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const reply = await backend.reply({
      message: "ping",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
    });
    expect("progressEvents" in reply).toBe(false);
    expect("progressMessages" in reply).toBe(false);
  });

  test("replyStream emits progress events and returns final reply", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "progress",
                  event: {
                    seq: 1,
                    message: "Edited sum.rs",
                    kind: "tool",
                    toolCallId: "call_1",
                    toolName: "edit-file",
                    phase: "tool_start",
                  },
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

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const received: Array<{ seq: number; message: string }> = [];
    const reply = await backend.replyStream(
      {
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      },
      {
        onEvents: (events) => {
          for (const event of events) {
            received.push({ seq: event.seq, message: event.message });
          }
        },
      },
    );

    expect(received).toEqual([{ seq: 1, message: "Edited sum.rs" }]);
    expect(reply.output).toBe("done");
    expect(reply.model).toBe("gpt-5-mini");
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

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        {
          onEvents: () => {},
        },
      ),
    ).rejects.toThrow("Provider quota exceeded");
  });
});

describe("remote backend status parsing", () => {
  test("status serializes grouped healthz payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          provider: {
            status: "openai",
            api_url: "https://api.openai.com/v1",
          },
          model: {
            status: "openai/gpt-5",
          },
          provider_ready: true,
          service: {
            status: "acolyte-backend",
            url: "http://localhost:6767",
          },
          memory: {
            status: "postgres",
            entries: 4,
          },
          om: {
            status: "enabled",
            scope: "resource",
            model: "openai/gpt-5",
            tokens: { obs: 3000, ref: 8000 },
            state: { exists: true, gen: 2 },
            last_observed: "2026-02-23T10:10:53.908Z",
            last_reflection: "2026-02-23T10:15:00.000Z",
          },
          permissions: "write",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=openai");
    expect(status).toContain("model=openai/gpt-5");
    expect(status).toContain("provider_ready=true");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
    expect(status).toContain("provider_api_url=https://api.openai.com/v1");
    expect(status).toContain("memory_storage=postgres");
    expect(status).toContain("memory_context=4");
    expect(status).toContain("om=enabled");
    expect(status).toContain("om_scope=resource");
    expect(status).toContain("om_model=openai/gpt-5");
    expect(status).toContain("om_obs_tokens=3000");
    expect(status).toContain("om_ref_tokens=8000");
    expect(status).toContain("om_exists=true");
    expect(status).toContain("om_gen=2");
    expect(status).toContain("om_last_observed=2026-02-23T10:10:53.908Z");
    expect(status).toContain("om_last_reflection=2026-02-23T10:15:00.000Z");
    expect(status).toContain("permission_mode=write");
  });

  test("status serializes single-shape healthz payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: {
            status: "openai-compatible/qwen2.5-coder",
          },
          provider_ready: true,
          service: {
            status: "acolyte-backend",
          },
          provider: {
            status: "openai-compatible",
            api_url: "https://router.example/v1",
          },
          permissions: "write",
          memory: {
            status: "postgres",
            entries: 6,
          },
          om: {
            status: "enabled",
            scope: "resource",
            model: "openai/gpt-5-mini",
            tokens: { obs: 3000, ref: 8000 },
            state: {
              exists: true,
              gen: 3,
            },
            last_observed: "2026-02-21T10:10:53.908Z",
            last_reflection: "2026-02-21T10:15:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=openai-compatible");
    expect(status).toContain("model=openai-compatible/qwen2.5-coder");
    expect(status).toContain("provider_ready=true");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
    expect(status).toContain("provider_api_url=https://router.example/v1");
    expect(status).toContain("memory_storage=postgres");
    expect(status).toContain("memory_context=6");
    expect(status).toContain("om=enabled");
    expect(status).toContain("om_scope=resource");
    expect(status).toContain("om_model=openai/gpt-5-mini");
    expect(status).toContain("om_obs_tokens=3000");
    expect(status).toContain("om_ref_tokens=8000");
    expect(status).toContain("om_exists=true");
    expect(status).toContain("om_gen=3");
    expect(status).toContain("om_last_observed=2026-02-21T10:10:53.908Z");
    expect(status).toContain("om_last_reflection=2026-02-21T10:15:00.000Z");
    expect(status).toContain("permission_mode=write");
  });

  test("status falls back to mode when provider is absent", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          mode: "mock",
          service: "acolyte-backend",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=mock");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
  });
});

describe("local backend status", () => {
  test("includes single-model provider and readiness rows", async () => {
    const backend = createBackend({ apiUrl: "" });
    const status = await backend.status();

    expect(status).toContain("provider=local-mock");
    expect(status).toContain("model=");
    expect(status).toContain("provider_ready=");
    expect(status).toContain("backend=embedded");
    expect(status).toContain("permission_mode=");
    expect(status).toContain("memory_context=");
  });
});
