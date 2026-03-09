import { describe, expect, test } from "bun:test";
import { fetchWeb, searchWeb } from "./web-ops";

describe("fetchWeb", () => {
  test("rejects invalid URL input", async () => {
    await expect(fetchWeb("not-a-url")).rejects.toThrow("Web fetch URL is invalid");
  });

  test("blocks localhost/private hosts", async () => {
    await expect(fetchWeb("http://localhost:6767/healthz")).rejects.toThrow("blocks localhost/private hosts");
  });

  test("blocks 10.x private range", async () => {
    await expect(fetchWeb("http://10.0.0.1/admin")).rejects.toThrow("blocks localhost/private hosts");
  });

  test("blocks 192.168.x private range", async () => {
    await expect(fetchWeb("http://192.168.1.1/")).rejects.toThrow("blocks localhost/private hosts");
  });

  test("blocks 172.16-31 private range", async () => {
    await expect(fetchWeb("http://172.16.0.1/")).rejects.toThrow("blocks localhost/private hosts");
  });

  test("blocks .local domains", async () => {
    await expect(fetchWeb("http://myhost.local/")).rejects.toThrow("blocks localhost/private hosts");
  });

  test("rejects ftp protocol", async () => {
    await expect(fetchWeb("ftp://example.com/file")).rejects.toThrow("only supports http/https");
  });
});

describe("searchWeb", () => {
  test("rejects empty query", async () => {
    await expect(searchWeb("")).rejects.toThrow("query cannot be empty");
  });

  test("rejects whitespace-only query", async () => {
    await expect(searchWeb("   ")).rejects.toThrow("query cannot be empty");
  });
});
