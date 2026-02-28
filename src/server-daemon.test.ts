import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localServerStatus, serverDaemonInternals, stopLocalServer } from "./server-daemon";

describe("server daemon internals", () => {
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

  test("clearStaleStartupLock removes invalid owner lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-daemon-lock-"));
    const path = join(dir, "server.start.lock");
    await writeFile(path, "not-a-pid", "utf8");
    await expect(serverDaemonInternals.clearStaleStartupLock(path)).resolves.toBe(true);
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  });

  test("clearStaleStartupLock keeps lock when owner process is alive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-daemon-lock-"));
    const path = join(dir, "server.start.lock");
    await writeFile(path, String(process.pid), "utf8");
    await expect(serverDaemonInternals.clearStaleStartupLock(path)).resolves.toBe(false);
    await expect(Bun.file(path).exists()).resolves.toBe(true);
  });

  test("localServerStatus removes stale server lock when endpoint is not healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(home);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        apiUrl: "http://127.0.0.1:9",
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await expect(localServerStatus({ homeDir: home })).resolves.toEqual({
      running: false,
      pid: null,
      apiUrl: null,
    });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("stopLocalServer returns false and removes stale lock when endpoint is not healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(home);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        apiUrl: "http://127.0.0.1:9",
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await expect(stopLocalServer({ homeDir: home })).resolves.toBe(false);
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });
});
