import { describe, expect, test } from "bun:test";
import { serverDaemonInternals } from "./server-daemon";

describe("server daemon internals", () => {
  test("serverLogPath uses server.log for default port", () => {
    const path = serverDaemonInternals.serverLogPath(6767, "/tmp/acolyte-home");
    expect(path).toBe("/tmp/acolyte-home/.acolyte/daemons/server.log");
  });

  test("serverLogPath uses port number for non-default port", () => {
    const path = serverDaemonInternals.serverLogPath(8080, "/tmp/acolyte-home");
    expect(path).toBe("/tmp/acolyte-home/.acolyte/daemons/8080.log");
  });

  test("parseServerLock accepts valid payload", () => {
    const parsed = serverDaemonInternals.parseServerLock(
      JSON.stringify({
        pid: 1234,
        port: 6767,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
    );
    expect(parsed).toEqual({
      pid: 1234,
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
