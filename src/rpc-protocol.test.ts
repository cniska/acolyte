import { describe, expect, test } from "bun:test";
import {
  RESERVED_RPC_CLIENT_TASK_METHODS,
  RESERVED_RPC_SERVER_TASK_METHODS,
  rpcClientMessageSchema,
  rpcServerMessageSchema,
} from "./rpc-protocol";

describe("rpc protocol schema", () => {
  test("accepts chat.start client messages", () => {
    const parsed = rpcClientMessageSchema.safeParse({
      id: "rpc_1",
      type: "chat.start",
      payload: {
        request: {
          message: "hi",
          history: [],
          model: "gpt-5-mini",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts chat.start verify scope override", () => {
    const parsed = rpcClientMessageSchema.safeParse({
      id: "rpc_1b",
      type: "chat.start",
      payload: {
        request: {
          message: "hi",
          history: [],
          model: "gpt-5-mini",
          verifyScope: "global",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts chat.done server messages", () => {
    const parsed = rpcServerMessageSchema.safeParse({
      id: "rpc_1",
      type: "chat.done",
      reply: {
        output: "done",
        model: "gpt-5-mini",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts chat.abort client messages", () => {
    const parsed = rpcClientMessageSchema.safeParse({
      id: "rpc_2",
      type: "chat.abort",
      payload: {
        requestId: "rpc_1",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts task.status client messages", () => {
    const parsed = rpcClientMessageSchema.safeParse({
      id: "rpc_2b",
      type: "task.status",
      payload: {
        taskId: "rpc_1",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts status.result with typed payload", () => {
    const parsed = rpcServerMessageSchema.safeParse({
      id: "rpc_3",
      type: "status.result",
      status: {
        ok: true,
        provider: "openai",
        model: "gpt-5-mini",
        protocolVersion: "v1",
        capabilities: "chat,permissions",
        permissions: "write",
        service: "http://localhost:6767",
        memory: "enabled",
        observational_memory: "enabled (resource)",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts chat lifecycle server messages", () => {
    const accepted = rpcServerMessageSchema.safeParse({
      id: "rpc_4",
      type: "chat.accepted",
    });
    const queued = rpcServerMessageSchema.safeParse({
      id: "rpc_4",
      type: "chat.queued",
      position: 1,
    });
    const started = rpcServerMessageSchema.safeParse({
      id: "rpc_4",
      type: "chat.started",
    });
    expect(accepted.success).toBe(true);
    expect(queued.success).toBe(true);
    expect(started.success).toBe(true);
  });

  test("accepts task.status.result server messages", () => {
    const found = rpcServerMessageSchema.safeParse({
      id: "rpc_5",
      type: "task.status.result",
      task: {
        id: "task_1",
        state: "running",
        createdAt: "2026-02-28T00:00:00.000Z",
        updatedAt: "2026-02-28T00:00:01.000Z",
      },
    });
    const missing = rpcServerMessageSchema.safeParse({
      id: "rpc_6",
      type: "task.status.result",
      task: null,
    });
    expect(found.success).toBe(true);
    expect(missing.success).toBe(true);
  });

  test("exposes reserved rpc task method names", () => {
    expect(RESERVED_RPC_CLIENT_TASK_METHODS).toEqual(["task.start", "task.status", "task.cancel", "task.attach"]);
    expect(RESERVED_RPC_SERVER_TASK_METHODS).toEqual(["task.accepted", "task.updated", "task.done", "task.error"]);
  });
});
