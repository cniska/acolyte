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

describe("createCloudSyncClient", () => {
  test("get sends authorization header", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = createCloudSyncClient("https://api.example.com", "test-token");
    await client.get("/api/v1/test");
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = callArgs(fn);
    expect(url).toBe("https://api.example.com/api/v1/test");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
  });

  test("get appends query params and omits undefined", async () => {
    const fn = jsonFetch(200, []);
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.get("/api/v1/memories", { scopeKey: "user_abc", kind: undefined });
    const [url] = callArgs(fn);
    expect(url).toBe("https://api.example.com/api/v1/memories?scopeKey=user_abc");
  });

  test("post sends JSON body", async () => {
    const fn = jsonFetch(200, { ok: true });
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.post("/api/v1/memories", { record: { id: "1" } });
    const [, init] = callArgs(fn);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ record: { id: "1" } }));
  });

  test("del sends DELETE method", async () => {
    const fn = jsonFetch(200, undefined, "");
    const client = createCloudSyncClient("https://api.example.com", "t");
    await client.del("/api/v1/memories/mem_1");
    const [, init] = callArgs(fn);
    expect(init.method).toBe("DELETE");
  });

  test("throws CloudApiError on non-ok response", async () => {
    jsonFetch(403, "forbidden", "text/plain");
    const client = createCloudSyncClient("https://api.example.com", "t");
    await expect(client.get("/api/v1/test")).rejects.toThrow(CloudApiError);
  });

  test("strips trailing slash from base URL", async () => {
    const fn = jsonFetch(200, {});
    const client = createCloudSyncClient("https://api.example.com/", "t");
    await client.get("/api/v1/test");
    const [url] = callArgs(fn);
    expect(url).toBe("https://api.example.com/api/v1/test");
  });

  test("returns undefined for non-JSON response", async () => {
    jsonFetch(204, undefined, "");
    const client = createCloudSyncClient("https://api.example.com", "t");
    const result = await client.del("/api/v1/test");
    expect(result).toBeUndefined();
  });
});
