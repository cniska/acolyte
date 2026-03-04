import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client";

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe("createClient", () => {
  test("falls back to configured/default apiUrl when explicit apiUrl is blank", async () => {
    globalThis.WebSocket = class FailingWebSocket {
      constructor() {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }
    } as unknown as typeof WebSocket;
    const client = createClient({ apiUrl: "" });
    await expect(client.status()).rejects.toThrow("Cannot reach server at ");
  });

  test("rpc transport mode creates rpc client", () => {
    const client = createClient({ transportMode: "rpc", apiUrl: "http://localhost:6767" });
    expect(client.constructor.name).toBe("RpcClient");
  });
});
