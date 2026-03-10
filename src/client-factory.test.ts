import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client-factory";

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe("createClient", () => {
  test("requires apiUrl", () => {
    expect(() => createClient({ apiUrl: "" })).toThrow();
  });

  test("creates rpc client", () => {
    const client = createClient({ apiUrl: "http://localhost:6767" });
    expect(client.constructor.name).toBe("RpcClient");
  });
});
