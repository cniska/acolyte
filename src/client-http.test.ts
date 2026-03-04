import { afterEach, describe, expect, test } from "bun:test";
import { createClient, parseStreamEvent } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote server connection errors", () => {
  test("status surfaces a user-friendly server-start hint on connection failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    await expect(client.status()).rejects.toThrow(
      "Cannot reach server at http://localhost:6767. Start it with: acolyte server start",
    );
  });

  test("status surfaces generic guidance for non-local apiUrl connection failures", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "https://api.example.com" });
    await expect(client.status()).rejects.toThrow(
      "Cannot reach server at https://api.example.com. Check apiUrl and server availability.",
    );
  });

  test("status explains https localhost mismatch for local daemon setups", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "https://localhost:6767" });
    await expect(client.status()).rejects.toThrow(
      "Cannot reach server at https://localhost:6767. Local daemon uses http:// (not https://); update apiUrl or run an HTTPS server.",
    );
  });

  test("status explains https localhost mismatch for ipv6 loopback", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "https://[::1]:6767" });
    await expect(client.status()).rejects.toThrow(
      "Cannot reach server at https://[::1]:6767. Local daemon uses http:// (not https://); update apiUrl or run an HTTPS server.",
    );
  });

  test("replyStream maps socket-close fetch errors to server-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("The socket connection was closed unexpectedly.");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        { onEvent: () => {} },
      ),
    ).rejects.toThrow("Cannot reach server at http://localhost:6767. Start it with: acolyte server start");
  });

  test("replyStream maps url-typo fetch errors to server-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Was there a typo in the url or port?");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        { onEvent: () => {} },
      ),
    ).rejects.toThrow("Cannot reach server at http://localhost:6767. Start it with: acolyte server start");
  });

  test("replyStream preserves non-connection errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        { onEvent: () => {} },
      ),
    ).rejects.toThrow("boom");
  });

  test("replyStream surfaces server error_id when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "model call failed",
          errorId: "err_abc12345",
          errorCode: "E_TIMEOUT",
          errorDetail: {
            code: "E_TIMEOUT",
            category: "timeout",
            source: "server",
            retryable: false,
            recoveryAction: "none",
          },
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    await expect(
      client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        { onEvent: () => {} },
      ),
    ).rejects.toThrow("Remote server stream failed (502): model call failed [error_id=err_abc12345]");
    try {
      await client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        { onEvent: () => {} },
      );
      throw new Error("expected reply to throw");
    } catch (error) {
      const remoteError = error as Error & {
        status?: number;
        errorCode?: string;
        errorDetail?: { recoveryAction?: string };
      };
      expect(remoteError.status).toBe(502);
      expect(remoteError.errorCode).toBe("E_TIMEOUT");
      expect(remoteError.errorDetail?.recoveryAction).toBe("none");
    }
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

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const received: Array<{ type: string; toolName?: string }> = [];
    const reply = await client.replyStream(
      {
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      },
      {
        onEvent: (event) => {
          if (event.type === "tool-call") received.push({ type: event.type, toolName: event.toolName });
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

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const reply = await client.replyStream(
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
                  errorCode: "E_PROVIDER_QUOTA",
                  errorDetail: {
                    code: "E_PROVIDER_QUOTA",
                    category: "provider",
                    source: "server",
                    retryable: false,
                    recoveryAction: "fail",
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

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const received: Array<{ type: string; errorDetail?: { code?: string; recoveryAction?: string } }> = [];
    try {
      await client.replyStream(
        {
          message: "ping",
          history: [],
          model: "gpt-5-mini",
          sessionId: "sess_test",
        },
        {
          onEvent: (event) => {
            if (event.type === "error") {
              received.push({
                type: event.type,
                errorDetail: {
                  code: event.errorDetail?.code,
                  recoveryAction: event.errorDetail?.recoveryAction,
                },
              });
            }
          },
        },
      );
      throw new Error("expected replyStream to throw");
    } catch (error) {
      const remoteError = error as Error & {
        errorCode?: string;
        errorDetail?: { recoveryAction?: string };
      };
      expect(remoteError.message).toContain("Provider quota exceeded");
      expect(remoteError.errorCode).toBe("E_PROVIDER_QUOTA");
      expect(remoteError.errorDetail?.recoveryAction).toBe("fail");
    }
    expect(received).toEqual([
      {
        type: "error",
        errorDetail: {
          code: "E_PROVIDER_QUOTA",
          recoveryAction: "fail",
        },
      },
    ]);
  });
});

describe("remote server status parsing", () => {
  test("status extracts flat string fields from response", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          providers: ["openai"],
          model: "gpt-5-mini",
          protocolVersion: "1",
          capabilities: "stream.sse, error.structured",
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

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const status = await client.status();

    expect(status).toEqual({
      providers: ["openai"],
      model: "gpt-5-mini",
      protocolVersion: "1",
      capabilities: "stream.sse, error.structured",
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
          providers: ["mock"],
          model: "gpt-5-mini",
          extra_number: 42,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const status = await client.status();

    expect(status).toEqual({
      providers: ["mock"],
      model: "gpt-5-mini",
    });
  });
});

describe("replyStream keepalive and timeout", () => {
  test("replyStream ignores SSE keepalive comments", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(":\n\n"));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", text: "hi" })}\n\n`));
            controller.enqueue(encoder.encode(":\n\n"));
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "done", reply: { model: "gpt-5-mini", output: "hi" } })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const events: string[] = [];
    const reply = await client.replyStream(
      { message: "ping", history: [], model: "gpt-5-mini", sessionId: "sess_test" },
      { onEvent: (e) => events.push(e.type) },
    );
    expect(reply.output).toBe("hi");
    expect(events).toEqual(["text-delta"]);
  });

  test("replyStream timeout resets on activity", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", text: "a" })}\n\n`));
            await new Promise((r) => setTimeout(r, 15));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", text: "b" })}\n\n`));
            await new Promise((r) => setTimeout(r, 15));
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "done", reply: { model: "gpt-5-mini", output: "ab" } })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch;

    // 25ms timeout — would fire if not reset, but each chunk arrives within 15ms
    const client = createClient({ apiUrl: "http://localhost:6767", replyTimeoutMs: 25 });
    const reply = await client.replyStream(
      { message: "ping", history: [], model: "gpt-5-mini", sessionId: "sess_test" },
      { onEvent: () => {} },
    );
    expect(reply.output).toBe("ab");
  });

  test("replyStream times out on inactivity", async () => {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never sends data — stream hangs
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch;

    const client = createClient({ apiUrl: "http://localhost:6767", replyTimeoutMs: 10 });
    await expect(
      client.replyStream(
        { message: "ping", history: [], model: "gpt-5-mini", sessionId: "sess_test" },
        { onEvent: () => {} },
      ),
    ).rejects.toThrow("timed out");
  });
});

describe("stream event parsing", () => {
  test("parseStreamEvent accepts structured error detail payloads", () => {
    const event = parseStreamEvent({
      type: "error",
      error: "Tool failed",
      errorCode: "E_TIMEOUT",
      errorDetail: {
        code: "E_TIMEOUT",
        category: "timeout",
        source: "generate",
        retryable: false,
        recoveryAction: "none",
      },
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("error");
    if (!event || event.type !== "error") return;
    expect(event.errorDetail?.retryable).toBe(false);
    expect(event.errorDetail?.recoveryAction).toBe("none");
  });

  test("parseStreamEvent rejects malformed structured error detail payloads", () => {
    const event = parseStreamEvent({
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "edit-file",
      isError: true,
      errorDetail: {
        retryable: "yes",
      },
    });
    expect(event).toBeNull();
  });
});
