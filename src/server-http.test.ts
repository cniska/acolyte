import { describe, expect, test } from "bun:test";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { createServerFetchHandler } from "./server-http";
import type { RunChatHandlers, StatusPayload } from "./server-contract";
import { savedPermissionMode } from "./test-utils";

function createTestDeps(overrides: Partial<Parameters<typeof createServerFetchHandler>[0]> = {}) {
  return {
    createStatusPayload: async () => ({ ok: true } as unknown as StatusPayload),
    hasValidAuth: () => true,
    isChatRequest: (value: unknown): value is ChatRequest => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as { message?: unknown };
      return typeof candidate.message === "string";
    },
    runChatRequest: async (_chatRequest: ChatRequest, handlers: RunChatHandlers) => {
      handlers.onDone({ output: "ok", model: "gpt-5-mini" });
    },
    serverError: (_message: string, _error: unknown, _details: Record<string, unknown>, status = 500) =>
      new Response("server error", { status }),
    shutdownServer: () => {},
    upgradeToRpc: () => true,
    ...overrides,
  } satisfies Parameters<typeof createServerFetchHandler>[0];
}

describe("server-http auth coverage", () => {
  test("/v1/permissions rejects unauthorized requests", async () => {
    const restore = savedPermissionMode();
    setPermissionMode("read");
    try {
      const handler = createServerFetchHandler(
        createTestDeps({
          hasValidAuth: () => false,
        }),
      );

      const response = await handler(
        new Request("http://localhost/v1/permissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "write" }),
        }),
      );

      expect(response?.status).toBe(401);
      expect(appConfig.agent.permissions.mode).toBe("read");
    } finally {
      restore();
    }
  });

  test("/v1/permissions accepts authorized requests", async () => {
    const restore = savedPermissionMode();
    setPermissionMode("read");
    try {
      const handler = createServerFetchHandler(createTestDeps({ hasValidAuth: () => true }));

      const response = await handler(
        new Request("http://localhost/v1/permissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "write" }),
        }),
      );

      expect(response?.status).toBe(200);
      expect(appConfig.agent.permissions.mode).toBe("write");
    } finally {
      restore();
    }
  });

  test("/v1/admin/shutdown rejects unauthorized requests", async () => {
    let shutdownCalls = 0;
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => false,
        shutdownServer: () => {
          shutdownCalls += 1;
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
        },
      }),
    );

    const response = await handler(new Request("http://localhost/v1/admin/shutdown", { method: "POST" }));

    expect(response?.status).toBe(200);
    expect(shutdownCalls).toBe(1);
  });

  test("/v1/chat/stream rejects unauthorized requests", async () => {
    let runCalls = 0;
    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: () => false,
        runChatRequest: async (_chatRequest: ChatRequest, handlers: RunChatHandlers) => {
          runCalls += 1;
          handlers.onDone({ output: "ok", model: "gpt-5-mini" });
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

  test("/v1/rpc authorization receives URL query context", async () => {
    let upgradeCalls = 0;
    const seenUrls: string[] = [];

    const handler = createServerFetchHandler(
      createTestDeps({
        hasValidAuth: (_req, url) => {
          seenUrls.push(url?.toString() ?? "");
          return url?.searchParams.get("apiKey") === "test-key";
        },
        upgradeToRpc: () => {
          upgradeCalls += 1;
          return false;
        },
      }),
    );

    const unauthorized = await handler(new Request("http://localhost/v1/rpc?apiKey=wrong"));
    const authorized = await handler(new Request("http://localhost/v1/rpc?apiKey=test-key"));

    expect(unauthorized?.status).toBe(401);
    expect(authorized?.status).toBe(400);
    expect(upgradeCalls).toBe(1);
    expect(seenUrls).toEqual([
      "http://localhost/v1/rpc?apiKey=wrong",
      "http://localhost/v1/rpc?apiKey=test-key",
    ]);
  });
});
