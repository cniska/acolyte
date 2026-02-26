import { describe, expect, test } from "bun:test";
import { parseArgs, waitForServer } from "./wait-server";

function startTestServer(fetch: (req: Request) => Response | Promise<Response>): { port: number; stop: () => void } {
  const attempts = 25;
  for (let i = 0; i < attempts; i += 1) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    try {
      const server = Bun.serve({ port, fetch });
      return { port: server.port ?? port, stop: () => server.stop(true) };
    } catch {
      // Retry with another random port.
    }
  }
  throw new Error("Unable to start test server after multiple attempts.");
}

describe("wait-server", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      url: "http://localhost:6767/v1/status",
      timeoutMs: 10_000,
    });
  });

  test("parseArgs reads explicit flags", () => {
    expect(parseArgs(["--url", "http://127.0.0.1:1234/v1/status", "--timeout-ms", "1500"])).toEqual({
      url: "http://127.0.0.1:1234/v1/status",
      timeoutMs: 1500,
    });
  });

  test("parseArgs rejects invalid timeout value", () => {
    expect(() => parseArgs(["--timeout-ms", "0"])).toThrow("Invalid value for --timeout-ms");
  });

  test("parseArgs rejects missing timeout value", () => {
    expect(() => parseArgs(["--timeout-ms"])).toThrow("Missing value for --timeout-ms");
  });

  test("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument: --wat");
  });

  test("waitForServer resolves when endpoint is healthy", async () => {
    const server = startTestServer(() =>
      Response.json({
        ok: true,
      }),
    );
    try {
      await expect(waitForServer(`http://127.0.0.1:${server.port}/v1/status`, 1000)).resolves.toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test("waitForServer times out when endpoint stays unavailable", async () => {
    await expect(waitForServer("http://127.0.0.1:9/v1/status", 250)).rejects.toThrow(
      "Timed out waiting for server at http://127.0.0.1:9/v1/status",
    );
  });
});
