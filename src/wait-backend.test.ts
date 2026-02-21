import { describe, expect, test } from "bun:test";
import { parseArgs, waitForBackend } from "./wait-backend";

describe("wait-backend", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      url: "http://localhost:6767/healthz",
      timeoutMs: 10_000,
    });
  });

  test("parseArgs reads explicit flags", () => {
    expect(parseArgs(["--url", "http://127.0.0.1:1234/healthz", "--timeout-ms", "1500"])).toEqual({
      url: "http://127.0.0.1:1234/healthz",
      timeoutMs: 1500,
    });
  });

  test("parseArgs rejects invalid timeout value", () => {
    expect(() => parseArgs(["--timeout-ms", "0"])).toThrow("Invalid value for --timeout-ms");
  });

  test("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument: --wat");
  });

  test("waitForBackend resolves when endpoint is healthy", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ok: true });
      },
    });
    try {
      await expect(waitForBackend(`http://127.0.0.1:${server.port}/healthz`, 1000)).resolves.toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("waitForBackend times out when endpoint stays unavailable", async () => {
    await expect(waitForBackend("http://127.0.0.1:9/healthz", 250)).rejects.toThrow(
      "Timed out waiting for backend at http://127.0.0.1:9/healthz",
    );
  });
});
