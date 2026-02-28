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
});
