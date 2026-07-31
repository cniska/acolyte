import { describe, expect, test } from "bun:test";
import type { ChatRequest } from "./api";
import type { RunChatHandlers } from "./server-contract";
import { createServerFetchHandler } from "./server-http";
import type { StatusPayload } from "./status-contract";

function createTestDeps(overrides: Partial<Parameters<typeof createServerFetchHandler>[0]> = {}) {
  return {
    createStatusPayload: async () => ({ ok: true }) as unknown as StatusPayload,
    hasValidAuth: () => true,
    isChatRequest: (value: unknown): value is ChatRequest => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as { message?: unknown };
      return typeof candidate.message === "string";
    },
    runChatRequest: async (_chatRequest: ChatRequest, handlers: RunChatHandlers) => {
      handlers.onDone({ outputStreamed: false, output: "ok", model: "gpt-5-mini" });
    },
    serverError: (_message: string, _error: unknown, _details: Record<string, unknown>, status = 500) =>
      new Response("server error", { status }),
    shutdownServer: () => ({ ok: true, shutdown: true }),
    upgradeToRpc: () => true,
    ...overrides,
  } satisfies Parameters<typeof createServerFetchHandler>[0];
}

describe("server-http auth coverage", () => {
  test("/v1/admin/shutdown rejects unauthorized requests", async () => {
    let shutdownCalls = 0;
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => false,
        shutdownServer: () => {
          shutdownCalls += 1;
          return { ok: true, shutdown: true };
        },
      }),
    );

    const response = await handler(new Request("http://localhost/v1/admin/shutdown", { method: "POST" }));

    expect(response?.status).toBe(401);
    expect(shutdownCalls).toBe(0);
  });

  test("/v1/admin/shutdown accepts authorized requests", async () => {
    let shutdownCalls = 0;
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => true,
        shutdownServer: () => {
          shutdownCalls += 1;
          return { ok: true, shutdown: true };
        },
      }),
    );

    const response = await handler(new Request("http://localhost/v1/admin/shutdown", { method: "POST" }));

    expect(response?.status).toBe(200);
    expect(shutdownCalls).toBe(1);
  });

  test("/v1/admin/shutdown refuses with the live tasks while a turn runs", async () => {
    const running = [{ taskId: "task_abc" as const, sessionId: "sess_xyz" as const }];
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => true,
        shutdownServer: (input) => (input.force ? { ok: true, shutdown: true } : { ok: false, running }),
      }),
    );

    const response = await handler(new Request("http://localhost/v1/admin/shutdown", { method: "POST" }));

    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ ok: false, running });
  });

  test("/v1/admin/shutdown honors force in the request body", async () => {
    const forced: boolean[] = [];
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => true,
        shutdownServer: (input) => {
          forced.push(input.force);
          return { ok: true, shutdown: true };
        },
      }),
    );

    const response = await handler(
      new Request("http://localhost/v1/admin/shutdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      }),
    );

    expect(response?.status).toBe(200);
    expect(forced).toEqual([true]);
  });

  test("/v1/admin/shutdown treats a bodyless request as force off", async () => {
    const forced: boolean[] = [];
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => true,
        shutdownServer: (input) => {
          forced.push(input.force);
          return { ok: true, shutdown: true };
        },
      }),
    );

    await handler(new Request("http://localhost/v1/admin/shutdown", { method: "POST" }));

    expect(forced).toEqual([false]);
  });

  test("/v1/chat/stream rejects unauthorized requests", async () => {
    let runCalls = 0;
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => false,
        runChatRequest: async (_chatRequest: ChatRequest, handlers: RunChatHandlers) => {
          runCalls += 1;
          handlers.onDone({ outputStreamed: false, output: "ok", model: "gpt-5-mini" });
        },
      }),
    );

    const response = await handler(
      new Request("http://localhost/v1/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", history: [], model: "gpt-5-mini" }),
      }),
    );

    expect(response?.status).toBe(401);
    expect(runCalls).toBe(0);
  });

  test("/v1/rpc rejects unauthorized and accepts Bearer header auth", async () => {
    let upgradeCalls = 0;

    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: (req) => req.headers.get("authorization") === "Bearer test-key",
        upgradeToRpc: () => {
          upgradeCalls += 1;
          return false;
        },
      }),
    );

    const unauthorized = await handler(new Request("http://localhost/v1/rpc"));
    const authorized = await handler(
      new Request("http://localhost/v1/rpc", { headers: { authorization: "Bearer test-key" } }),
    );

    expect(unauthorized?.status).toBe(401);
    expect(authorized?.status).toBe(400);
    expect(upgradeCalls).toBe(1);
  });
});
