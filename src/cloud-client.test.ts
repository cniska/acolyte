import { afterEach, describe, expect, test } from "bun:test";
import { CloudApiError, CloudClient } from "./cloud-client";
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
    const client = new CloudClient("https://api.example.com", "test-token");
    await client.memory.list();
    expect(fn).toHaveBeenCalledTimes(1);
    const [, init] = callArgs(fn);
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
  });

  test("strips trailing slash from base URL", async () => {
    const fn = jsonFetch(200, []);
    const client = new CloudClient("https://api.example.com/", "t");
    await client.memory.list();
    const [url] = callArgs(fn);
    expect(url).toStartWith("https://api.example.com/api/");
  });

  test("throws CloudApiError on non-ok response", async () => {
    jsonFetch(403, "forbidden", "text/plain");
    const client = new CloudClient("https://api.example.com", "t");
    await expect(client.memory.list()).rejects.toThrow(CloudApiError);
  });

  test("memory.list passes query params", async () => {
    const fn = jsonFetch(200, []);
    const client = new CloudClient("https://api.example.com", "t");
    await client.memory.list({ scopeKey: "user_abc", kind: "stored" });
    const [url] = callArgs(fn);
    expect(url).toContain("scopeKey=user_abc");
    expect(url).toContain("kind=stored");
  });

  test("memory.write sends POST with record", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = new CloudClient("https://api.example.com", "t");
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
    const client = new CloudClient("https://api.example.com", "t");
    await client.memory.remove("mem_1");
    const [url, init] = callArgs(fn);
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/mem_1");
  });

  test("session.listSessions passes limit param", async () => {
    const fn = jsonFetch(200, []);
    const client = new CloudClient("https://api.example.com", "t");
    await client.session.listSessions({ limit: 10 });
    const [url] = callArgs(fn);
    expect(url).toContain("limit=10");
  });

  test("session.saveSession sends POST on first save", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = new CloudClient("https://api.example.com", "t");
    await client.session.saveSession({ id: "sess_1" } as never);
    const [, init] = callArgs(fn);
    expect(init.method).toBe("POST");
  });

  test("session.saveSession sends PATCH append after first save", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = new CloudClient("https://api.example.com", "t");
    const session = {
      id: "sess_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      model: "gpt-5-mini",
      title: "test",
      messages: [{ id: "msg_1", role: "user", content: "hello", kind: "text", timestamp: "2026-01-01T00:00:00.000Z" }],
      tokenUsage: [],
    } as never;
    await client.session.saveSession(session);
    expect(callArgs(fn, 0)[1].method).toBe("POST");

    (session as { updatedAt: string }).updatedAt = "2026-01-01T00:01:00.000Z";
    await client.session.saveSession(session);
    const [url, init] = callArgs(fn, 1);
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/sess_1/append");
  });

  test("session.saveSession append sends only new messages", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = new CloudClient("https://api.example.com", "t");
    const msg1 = { id: "msg_1", role: "user", content: "hello", kind: "text", timestamp: "2026-01-01T00:00:00.000Z" };
    const msg2 = { id: "msg_2", role: "assistant", content: "hi", kind: "text", timestamp: "2026-01-01T00:00:01.000Z" };
    const session = {
      id: "sess_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      model: "gpt-5-mini",
      title: "test",
      messages: [msg1],
      tokenUsage: [],
    };
    await client.session.saveSession(session as never);

    session.messages.push(msg2 as never);
    session.updatedAt = "2026-01-01T00:01:00.000Z";
    await client.session.saveSession(session as never);

    const [, init] = callArgs(fn, 1);
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toBe("msg_2");
  });

  test("gzips large request bodies", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = new CloudClient("https://api.example.com", "t");
    const largeContent = "x".repeat(2000);
    const record = {
      id: "mem_1",
      scopeKey: "user_x",
      kind: "stored" as const,
      content: largeContent,
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    };
    await client.memory.write(record);
    const [, init] = callArgs(fn);
    expect((init.headers as Record<string, string>)["content-encoding"]).toBe("gzip");
  });
});
