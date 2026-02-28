import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLocalServer, localServerStatus, serverDaemonInternals, stopLocalServer } from "./server-daemon";
import { startTestServer } from "./test-factory";

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
      managed: false,
    });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("localServerStatus falls back to unmanaged target when stale lock endpoint is unhealthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(home);
    const server = startTestServer(() => Response.json({ ok: true }));
    const targetApiUrl = `http://127.0.0.1:${server.port}`;
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
    try {
      await expect(localServerStatus({ homeDir: home, apiUrl: targetApiUrl })).resolves.toEqual({
        running: true,
        pid: null,
        apiUrl: targetApiUrl,
        managed: false,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      server.stop();
    }
  });

  test("localServerStatus falls back to unmanaged target when lock pid is dead", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(home);
    const server = startTestServer(() => Response.json({ ok: true }));
    const targetApiUrl = `http://127.0.0.1:${server.port}`;
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999,
        apiUrl: targetApiUrl,
        port: server.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(localServerStatus({ homeDir: home, apiUrl: targetApiUrl })).resolves.toEqual({
        running: true,
        pid: null,
        apiUrl: targetApiUrl,
        managed: false,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      server.stop();
    }
  });

  test("localServerStatus prefers requested target when healthy lock points at different url", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockedServer = startTestServer(() => Response.json({ ok: true }));
    const targetServer = startTestServer(() => Response.json({ ok: true }));
    const lockApiUrl = `http://127.0.0.1:${lockedServer.port}`;
    const targetApiUrl = `http://127.0.0.1:${targetServer.port}`;
    const lockPath = serverDaemonInternals.serverLockPath(home);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        apiUrl: lockApiUrl,
        port: lockedServer.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(localServerStatus({ homeDir: home, apiUrl: targetApiUrl })).resolves.toEqual({
        running: true,
        pid: null,
        apiUrl: targetApiUrl,
        managed: false,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(true);
    } finally {
      lockedServer.stop();
      targetServer.stop();
    }
  });

  test("localServerStatus reports unmanaged running server when lock is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => Response.json({ ok: true }));
    const apiUrl = `http://127.0.0.1:${server.port}`;
    try {
      await expect(localServerStatus({ homeDir: home, apiUrl })).resolves.toEqual({
        running: true,
        pid: null,
        apiUrl,
        managed: false,
      });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer returns unmanaged reuse when server is healthy without lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => Response.json({ ok: true }));
    const apiUrl = `http://127.0.0.1:${server.port}`;
    try {
      await expect(
        ensureLocalServer({
          apiUrl,
          port: server.port,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
        }),
      ).resolves.toEqual({ apiUrl, started: false, managed: false });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer returns managed reuse when lock and healthy server match", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => Response.json({ ok: true }));
    const apiUrl = `http://127.0.0.1:${server.port}`;
    const lockPath = serverDaemonInternals.serverLockPath(home);
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        apiUrl,
        port: server.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(
        ensureLocalServer({
          apiUrl,
          port: server.port,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
        }),
      ).resolves.toEqual({ apiUrl, started: false, managed: true });
    } finally {
      server.stop();
    }
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
