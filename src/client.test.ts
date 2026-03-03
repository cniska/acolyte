import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createClient", () => {
  test("falls back to configured/default apiUrl when explicit apiUrl is blank", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;
    const client = createClient({ apiUrl: "" });
    await expect(client.status()).rejects.toThrow("Cannot reach server at ");
  });

  test("uses injected transport when provided", async () => {
    const calls: Array<{ path: string; method: string | null }> = [];
    const client = createClient({
      transport: {
        apiUrl: "rpc://local",
        request: async (path, init) => {
          calls.push({ path, method: init?.method ?? null });
          if (path === "/v1/status") {
            return new Response(JSON.stringify({ ok: true, provider: "mock" }), { status: 200 });
          }
          throw new Error("unexpected path");
        },
      },
    });

    const status = await client.status();
    expect(status).toEqual({ provider: "mock" });
    expect(calls).toEqual([{ path: "/v1/status", method: null }]);
  });

  test("http transport rejects taskStatus calls", async () => {
    const client = createClient({
      transport: {
        apiUrl: "http://localhost:6767",
        request: async () => {
          throw new Error("unexpected");
        },
      },
    });
    await expect(client.taskStatus("task_1")).rejects.toThrow("task.status is only supported over RPC transport");
  });
});
