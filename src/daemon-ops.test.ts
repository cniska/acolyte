import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isProcessAlive, parseServerLock, serverLogPath } from "./daemon-ops";
import { stateDir } from "./paths";

describe("daemon ops", () => {
  test("serverLogPath uses server.log for default port", () => {
    const env = { HOME: "/tmp/acolyte-home" };
    expect(serverLogPath(6767, env)).toBe(join(stateDir(env), "daemons", "server.log"));
  });

  test("serverLogPath uses port number for non-default port", () => {
    const env = { HOME: "/tmp/acolyte-home" };
    expect(serverLogPath(8080, env)).toBe(join(stateDir(env), "daemons", "8080.log"));
  });

  test("parseServerLock accepts valid payload", () => {
    expect(parseServerLock(JSON.stringify({ pid: 1234, port: 6767, startedAt: "2026-02-28T00:00:00.000Z" }))).toEqual({
      pid: 1234,
      port: 6767,
      startedAt: "2026-02-28T00:00:00.000Z",
    });
  });

  test("parseServerLock rejects invalid payload", () => {
    expect(parseServerLock("{}")).toBeNull();
    expect(parseServerLock("not-json")).toBeNull();
  });

  test("isProcessAlive returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("isProcessAlive rejects impossible pid", () => {
    expect(isProcessAlive(-1)).toBe(false);
  });
});
