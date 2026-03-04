import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLocalServer, localServerStatus, serverDaemonInternals, stopLocalServer } from "./server-daemon";
import { startTestServer } from "./test-utils";

function compatibleStatusResponse(): Response {
  return Response.json({ ok: true, protocol_version: "1" });
}

describe("server daemon internals", () => {
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
    const server = startTestServer(() => compatibleStatusResponse());
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
    const server = startTestServer(() => compatibleStatusResponse());
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
    const lockedServer = startTestServer(() => compatibleStatusResponse());
    const targetServer = startTestServer(() => compatibleStatusResponse());
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
    const server = startTestServer(() => compatibleStatusResponse());
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
    const server = startTestServer(() => compatibleStatusResponse());
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
    const server = startTestServer(() => compatibleStatusResponse());
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

  test("ensureLocalServer keeps healthy lock when requested target differs", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockedServer = startTestServer(() => compatibleStatusResponse());
    const targetServer = startTestServer(() => compatibleStatusResponse());
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
      await expect(
        ensureLocalServer({
          apiUrl: targetApiUrl,
          port: targetServer.port,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
        }),
      ).resolves.toEqual({ apiUrl: targetApiUrl, started: false, managed: false });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(true);
    } finally {
      lockedServer.stop();
      targetServer.stop();
    }
  });

  test("ensureLocalServer clears managed lock and terminates old pid when switching target", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockedServer = startTestServer(() => compatibleStatusResponse());
    const lockApiUrl = `http://127.0.0.1:${lockedServer.port}`;
    const targetApiUrl = "http://127.0.0.1:9";
    const lockPath = serverDaemonInternals.serverLockPath(home);
    const startLockPath = serverDaemonInternals.startupLockPath(home);
    const worker = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: worker.pid,
        apiUrl: lockApiUrl,
        port: lockedServer.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await writeFile(startLockPath, String(process.pid), "utf8");
    try {
      await expect(
        ensureLocalServer({
          apiUrl: targetApiUrl,
          port: 9,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
          timeoutMs: 250,
        }),
      ).rejects.toThrow(`Timed out waiting for server at ${targetApiUrl}`);
      await Bun.sleep(120);
      expect(serverDaemonInternals.isProcessAlive(worker.pid)).toBe(false);
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      lockedServer.stop();
      if (serverDaemonInternals.isProcessAlive(worker.pid)) worker.kill();
      await worker.exited.catch(() => {});
      await rm(startLockPath, { force: true });
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

  test("localServerStatus removes lock when status payload is protocol-incompatible", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(home);
    const staleServer = startTestServer(() => Response.json({ ok: true, protocolVersion: "1" }));
    const staleApiUrl = `http://127.0.0.1:${staleServer.port}`;
    await mkdir(join(home, ".acolyte"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        apiUrl: staleApiUrl,
        port: staleServer.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(localServerStatus({ homeDir: home })).resolves.toEqual({
        running: false,
        pid: null,
        apiUrl: null,
        managed: false,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      staleServer.stop();
    }
  });
});
