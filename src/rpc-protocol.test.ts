import { describe, expect, test } from "bun:test";
import { rpcClientMessageSchema, rpcServerMessageSchema } from "./rpc-protocol";

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
});
