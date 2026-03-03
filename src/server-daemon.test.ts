import { describe, expect, test } from "bun:test";
import { serverDaemonInternals } from "./server-daemon";

describe("server daemon internals", () => {
  test("serverLogPath resolves under ~/.acolyte", () => {
    const path = serverDaemonInternals.serverLogPath("/tmp/acolyte-home");
    expect(path).toBe("/tmp/acolyte-home/.acolyte/server.log");
  });

  test("parseServerLock accepts valid payload", () => {
    const parsed = serverDaemonInternals.parseServerLock(
      JSON.stringify({
        pid: 1234,
        apiUrl: "http://127.0.0.1:6767",
        port: 6767,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
    );
    expect(parsed).toEqual({
      pid: 1234,
      apiUrl: "http://127.0.0.1:6767",
      port: 6767,
      startedAt: "2026-02-28T00:00:00.000Z",
    });
  });

  test("parseServerLock rejects invalid payload", () => {
    expect(serverDaemonInternals.parseServerLock("{}")).toBeNull();
    expect(serverDaemonInternals.parseServerLock("not-json")).toBeNull();
  });

  test("isProcessAlive returns true for current process", () => {
    expect(serverDaemonInternals.isProcessAlive(process.pid)).toBe(true);
  });

  test("isProcessAlive rejects impossible pid", () => {
    expect(serverDaemonInternals.isProcessAlive(-1)).toBe(false);
  });
});
