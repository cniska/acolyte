import { afterEach, describe, expect, test } from "bun:test";
import { CloudApiError, createCloudSyncClient } from "./cloud-sync-client";
import { mockFetch } from "./test-utils";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function jsonFetch(status: number, body?: unknown, contentType = "application/json") {
  const result = mockFetch(
    async () =>
      new Response(body !== undefined ? JSON.stringify(body) : null, {
        status,
        headers: contentType ? { "content-type": contentType } : {},
      }),
  );
  cleanup = result.restore;
  return result.fn;
}

function callArgs(fn: ReturnType<typeof jsonFetch>, index = 0): [string, RequestInit] {
  return fn.mock.calls[index] as unknown as [string, RequestInit];
}

describe("cloud sync client", () => {
  test("sends authorization header", async () => {
    const fn = jsonFetch(200, []);
    const client = createCloudSyncClient("https://api.example.com", "test-token");
    await client.memory.list();
    expect(fn).toHaveBeenCalledTimes(1);
    const [, init] = callArgs(fn);
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
  });

  test("strips trailing slash from base URL", async () => {
    const fn = jsonFetch(200, []);
    const client = createCloudSyncClient("https://api.example.com/", "t");
    await client.memory.list();
    const [url] = callArgs(fn);
    expect(url).toStartWith("https://api.example.com/api/");
  });

  test("throws CloudApiError on non-ok response", async () => {
    jsonFetch(403, "forbidden", "text/plain");
    const client = createCloudSyncClient("https://api.example.com", "t");
    await expect(client.memory.list()).rejects.toThrow(CloudApiError);
  });

  test("memory.list passes query params", async () => {
    const fn = jsonFetch(200, []);
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.memory.list({ scopeKey: "user_abc", kind: "stored" });
    const [url] = callArgs(fn);
    expect(url).toContain("scopeKey=user_abc");
    expect(url).toContain("kind=stored");
  });

  test("memory.write sends POST with record", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = createCloudSyncClient("https://api.example.com", "t");
    const record = {
      id: "mem_1",
      scopeKey: "user_x",
      kind: "stored" as const,
      content: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    };
    await client.memory.write(record);
    const [, init] = callArgs(fn);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ record: { id: "mem_1" } });
  });

  test("memory.remove sends DELETE", async () => {
    const fn = jsonFetch(200, undefined, "");
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.memory.remove("mem_1");
    const [url, init] = callArgs(fn);
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/mem_1");
  });

  test("session.listSessions passes limit param", async () => {
    const fn = jsonFetch(200, []);
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.session.listSessions({ limit: 10 });
    const [url] = callArgs(fn);
    expect(url).toContain("limit=10");
  });

  test("session.saveSession sends POST", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.session.saveSession({ id: "sess_1" } as never);
    const [, init] = callArgs(fn);
    expect(init.method).toBe("POST");
  });
});
