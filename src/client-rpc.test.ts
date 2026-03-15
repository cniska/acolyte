import { afterEach, describe, expect, test } from "bun:test";
import { rpcUrlFromApiUrl } from "./client-contract";
import { createClient } from "./client-factory";

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe("rpc url helpers", () => {
  test("rpcUrlFromApiUrl maps http base url to ws rpc endpoint", () => {
    expect(rpcUrlFromApiUrl("http://localhost:6767")).toBe("ws://localhost:6767/v1/rpc");
  });

  test("rpcUrlFromApiUrl preserves explicit rpc path", () => {
    expect(rpcUrlFromApiUrl("ws://localhost:6767/v1/rpc")).toBe("ws://localhost:6767/v1/rpc");
  });
});

describe("rpc websocket lifecycle", () => {
  test("replyStream emits rpc status phases and forwards tool events", async () => {
    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private closed = false;

      constructor(public readonly url: string) {
        void this.url;
        queueMicrotask(() => this.emit("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string): void {
        const msg = JSON.parse(payload) as { id?: string; type?: string };
        if (msg.type !== "chat.start" || typeof msg.id !== "string") return;
        const sendMessage = (body: Record<string, unknown>) => {
          this.emit("message", { data: JSON.stringify({ id: msg.id, ...body }) });
        };
        queueMicrotask(() => sendMessage({ type: "chat.accepted", taskId: "task_rpc1" }));
        queueMicrotask(() => sendMessage({ type: "chat.queued", position: 2 }));
        queueMicrotask(() => sendMessage({ type: "chat.queued", position: 1 }));
        queueMicrotask(() => sendMessage({ type: "chat.started" }));
        queueMicrotask(() => sendMessage({ type: "chat.abort.result", requestId: msg.id, aborted: false }));
        queueMicrotask(() =>
          sendMessage({
            type: "chat.event",
            event: { type: "tool-call", toolCallId: "call_1", toolName: "read-file", args: { path: "a.ts" } },
          }),
        );
        queueMicrotask(() => sendMessage({ type: "chat.done", reply: { output: "done", model: "gpt-5-mini" } }));
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit("close", {});
      }

      private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const receivedEventTypes: string[] = [];
    const reply = await client.replyStream(
      { message: "hi", history: [], model: "gpt-5-mini", sessionId: "sess_rpc" },
      {
        onEvent: (event) => {
          receivedEventTypes.push(event.type);
        },
      },
    );

    expect(reply.output).toBe("done");
    expect(receivedEventTypes).toEqual(["status", "status", "status", "status", "tool-call"]);
  });

  test("replyStream sends chat.abort control message on abort signal", async () => {
    const sent: Array<{ id?: string; type?: string; payload?: Record<string, unknown> }> = [];

    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private closed = false;

      constructor(public readonly url: string) {
        void this.url;
        queueMicrotask(() => this.emit("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string): void {
        sent.push(JSON.parse(payload) as { id?: string; type?: string; payload?: Record<string, unknown> });
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit("close", {});
      }

      private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const client = createClient({ apiUrl: "http://localhost:6767" });
    const controller = new AbortController();

    const run = client.replyStream(
      { message: "hi", history: [], model: "gpt-5-mini", sessionId: "sess_rpcabort" },
      { onEvent: () => {}, signal: controller.signal },
    );

    for (let i = 0; i < 100 && !sent.some((msg) => msg.type === "chat.start"); i += 1) {
      await Promise.resolve();
    }
    controller.abort();

    await expect(run).rejects.toThrow("Request aborted");
    expect(sent.some((msg) => msg.type === "chat.start")).toBe(true);
    expect(
      sent.some(
        (msg) =>
          msg.type === "chat.abort" &&
          typeof msg.payload?.requestId === "string" &&
          msg.payload.requestId.startsWith("rpc_"),
      ),
    ).toBe(true);
  });

  test("replyStream fails cleanly when rpc connection closes mid-chat", async () => {
    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private closed = false;

      constructor(public readonly url: string) {
        void this.url;
        queueMicrotask(() => this.emit("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string): void {
        const msg = JSON.parse(payload) as { id?: string; type?: string };
        if (msg.type !== "chat.start" || typeof msg.id !== "string") return;
        const sendMessage = (body: Record<string, unknown>) => {
          this.emit("message", { data: JSON.stringify({ id: msg.id, ...body }) });
        };
        queueMicrotask(() => sendMessage({ type: "chat.accepted", taskId: "task_rpc2" }));
        queueMicrotask(() => sendMessage({ type: "chat.started" }));
        queueMicrotask(() =>
          sendMessage({
            type: "chat.event",
            event: { type: "tool-call", toolCallId: "call_1", toolName: "read-file", args: { path: "a.ts" } },
          }),
        );
        queueMicrotask(() => this.close());
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit("close", {});
      }

      private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    const client = createClient({ apiUrl: "http://localhost:6767" });
    const receivedEventTypes: string[] = [];

    try {
      await client.replyStream(
        { message: "hi", history: [], model: "gpt-5-mini", sessionId: "sess_rpcdisconnect" },
        {
          onEvent: (event) => {
            receivedEventTypes.push(event.type);
          },
        },
      );
      throw new Error("expected replyStream to reject");
    } catch (error) {
      const rpcError = error as Error & { taskId?: string };
      expect(rpcError.message).toBe("RPC stream closed before final reply");
      expect(typeof rpcError.taskId).toBe("string");
      expect(rpcError.taskId?.startsWith("task_")).toBe(true);
    }

    expect(receivedEventTypes).toEqual(["status", "status", "tool-call"]);
  });

  test("taskStatus requests and parses rpc task status payloads", async () => {
    class MockWebSocket {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private closed = false;

      constructor(public readonly url: string) {
        void this.url;
        queueMicrotask(() => this.emit("open", {}));
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string): void {
        const msg = JSON.parse(payload) as { id?: string; type?: string; payload?: { taskId?: string } };
        if (msg.type !== "task.status" || typeof msg.id !== "string") return;
        queueMicrotask(() =>
          this.emit("message", {
            data: JSON.stringify({
              id: msg.id,
              type: "task.status.result",
              task: {
                id: msg.payload?.taskId ?? "task_unknown0",
                state: "running",
                createdAt: "2026-02-28T00:00:00.000Z",
                updatedAt: "2026-02-28T00:00:01.000Z",
              },
            }),
          }),
        );
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit("close", {});
      }

      private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const client = createClient({ apiUrl: "http://localhost:6767" });
    const task = await client.taskStatus("task_123");
    expect(task?.id).toBe("task_123");
    expect(task?.state).toBe("running");
  });
});
