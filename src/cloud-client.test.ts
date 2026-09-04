import { afterEach, describe, expect, test } from "bun:test";
import { CloudApiError, CloudClient } from "./cloud-client";
import { CloudSession } from "./cloud-session";
import { mockFetch } from "./test-utils";

function testClient(token = "t", baseUrl = "https://api.example.com"): CloudClient {
  return new CloudClient(baseUrl, new CloudSession({ baseUrl, token }));
}

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
    const client = testClient("test-token");
    await client.memory.list();
    expect(fn).toHaveBeenCalledTimes(1);
    const [, init] = callArgs(fn);
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
  });

  test("strips trailing slash from base URL", async () => {
    const fn = jsonFetch(200, []);
    const client = testClient("t", "https://api.example.com/");
    await client.memory.list();
    const [url] = callArgs(fn);
    expect(url).toStartWith("https://api.example.com/api/");
  });

  test("throws CloudApiError on non-ok response", async () => {
    jsonFetch(403, "forbidden", "text/plain");
    const client = testClient();
    await expect(client.memory.list()).rejects.toThrow(CloudApiError);
  });

  test("memory.list passes query params", async () => {
    const fn = jsonFetch(200, []);
    const client = testClient();
    await client.memory.list({ scopeKey: "user_abc" });
    const [url] = callArgs(fn);
    expect(url).toContain("scopeKey=user_abc");
  });

  test("memory.write sends POST with record", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = testClient();
    const record = {
      id: "mem_1",
      scopeKey: "user_x",
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
    const client = testClient();
    await client.memory.remove("mem_1");
    const [url, init] = callArgs(fn);
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/mem_1");
  });

  test("session.listSessions passes limit param", async () => {
    const fn = jsonFetch(200, []);
    const client = testClient();
    await client.session.listSessions({ limit: 10 });
    const [url] = callArgs(fn);
    expect(url).toContain("limit=10");
  });

  test("session.saveSession sends POST on first save", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = testClient();
    await client.session.saveSession({ id: "sess_1" } as never);
    const [, init] = callArgs(fn);
    expect(init.method).toBe("POST");
  });

  test("session.saveSession sends PATCH append after first save", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = testClient();
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
    const client = testClient();
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

  test("session.searchSession sends POST with query", async () => {
    const fn = jsonFetch(200, [
      { id: "msg_1", role: "user", content: "fix auth", kind: "text", timestamp: "2026-01-01T00:00:00.000Z" },
    ]);
    const client = testClient();
    const results = await client.session.searchSession("sess_1", "auth", { limit: 5 });
    const [url, init] = callArgs(fn);
    expect(url).toContain("/sessions/sess_1/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe("auth");
    expect(body.limit).toBe(5);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("fix auth");
  });

  test("a rejected token is renewed and the request retried with the new one", async () => {
    const responses = [
      new Response(null, { status: 401 }),
      new Response(JSON.stringify({ token: "renewed-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const { fn, restore } = mockFetch(async () => responses.shift() ?? new Response(null, { status: 500 }));
    cleanup = restore;
    const base = "https://api.example.com";
    const session = new CloudSession({
      baseUrl: base,
      token: "spent-token",
      renewal: { refreshToken: "refresh-1", persistToken: async () => {} },
    });

    await new CloudClient(base, session).memory.list();

    expect(fn).toHaveBeenCalledTimes(3);
    const [refreshUrl] = callArgs(fn, 1);
    expect(refreshUrl).toBe("https://api.example.com/api/v1/auth/refresh");
    const [, retry] = callArgs(fn, 2);
    expect(retry.headers).toMatchObject({ authorization: "Bearer renewed-token" });
  });

  test("the retried request keeps the body and headers the first one carried", async () => {
    const responses = [
      new Response(null, { status: 401 }),
      new Response(JSON.stringify({ token: "renewed-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const { fn, restore } = mockFetch(async () => responses.shift() ?? new Response(null, { status: 500 }));
    cleanup = restore;
    const base = "https://api.example.com";
    const session = new CloudSession({
      baseUrl: base,
      token: "spent-token",
      renewal: { refreshToken: "refresh-1", persistToken: async () => {} },
    });

    await new CloudClient(base, session).memory.write({
      id: "mem_1",
      scopeKey: "user_x",
      content: "x".repeat(2000),
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    });

    const [firstUrl, first] = callArgs(fn, 0);
    const [retryUrl, retry] = callArgs(fn, 2);
    expect(retryUrl).toBe(firstUrl);
    expect(retry.method).toBe("POST");
    expect(retry.body).toEqual(first.body as BodyInit);
    expect(retry.headers).toMatchObject({ "content-encoding": "gzip", "content-type": "application/json" });
  });

  test("a cloud that cannot renew still fails with its own status, not the renewal's", async () => {
    const { fn, restore } = mockFetch(async (input) => {
      if (String(input).includes("/auth/refresh")) throw new TypeError("fetch failed");
      return new Response("no", { status: 401 });
    });
    cleanup = restore;
    const base = "https://api.example.com";
    const session = new CloudSession({
      baseUrl: base,
      token: "spent-token",
      renewal: { refreshToken: "refresh-1", persistToken: async () => {} },
    });

    await expect(new CloudClient(base, session).memory.list()).rejects.toThrow(CloudApiError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("a 401 that renewal cannot fix is raised, not retried forever", async () => {
    const { fn, restore } = mockFetch(async () => new Response("no", { status: 401 }));
    cleanup = restore;
    const base = "https://api.example.com";
    const session = new CloudSession({
      baseUrl: base,
      token: "spent-token",
      renewal: { refreshToken: "refresh-1", persistToken: async () => {} },
    });

    await expect(new CloudClient(base, session).memory.list()).rejects.toThrow(CloudApiError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("gzips large request bodies", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = testClient();
    const largeContent = "x".repeat(2000);
    const record = {
      id: "mem_1",
      scopeKey: "user_x",
      content: largeContent,
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    };
    await client.memory.write(record);
    const [, init] = callArgs(fn);
    expect((init.headers as Record<string, string>)["content-encoding"]).toBe("gzip");
  });
});
