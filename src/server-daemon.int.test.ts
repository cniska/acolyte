import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "./protocol";
import { ensureLocalServer, localServerStatus, serverDaemonInternals, stopLocalServer } from "./server-daemon";
import { startTestServer } from "./test-utils";

function compatibleStatusResponse(): Response {
  return Response.json({ ok: true, protocol_version: PROTOCOL_VERSION });
}

describe("server daemon internals", () => {
  test("clearStaleStartupLock removes invalid owner lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-daemon-lock-"));
    const path = join(dir, "6767.start.lock");
    await writeFile(path, "not-a-pid", "utf8");
    await expect(serverDaemonInternals.clearStaleStartupLock(path)).resolves.toBe(true);
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  });

  test("clearStaleStartupLock keeps lock when owner process is alive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-daemon-lock-"));
    const path = join(dir, "6767.start.lock");
    await writeFile(path, String(process.pid), "utf8");
    await expect(serverDaemonInternals.clearStaleStartupLock(path)).resolves.toBe(false);
    await expect(Bun.file(path).exists()).resolves.toBe(true);
  });

  test("localServerStatus removes stale server lock when endpoint is not healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(9, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await expect(localServerStatus({ port: 9, homeDir: home })).resolves.toEqual({
      running: false,
      pid: null,
      port: 9,
    });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("localServerStatus reports running when lock and server are healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverDaemonInternals.serverLockPath(server.port, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        port: server.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(localServerStatus({ port: server.port, homeDir: home })).resolves.toEqual({
        running: true,
        pid: process.pid,
        port: server.port,
      });
    } finally {
      server.stop();
    }
  });

  test("localServerStatus removes lock when pid is dead", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverDaemonInternals.serverLockPath(server.port, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999,
        port: server.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      // Lock is cleared because pid 999999 is dead, but server is healthy so it reports running with null pid
      await expect(localServerStatus({ port: server.port, homeDir: home })).resolves.toEqual({
        running: true,
        pid: null,
        port: server.port,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      server.stop();
    }
  });

  test("localServerStatus reports not running when no lock and no server", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    await expect(localServerStatus({ port: 9, homeDir: home })).resolves.toEqual({
      running: false,
      pid: null,
      port: 9,
    });
  });

  test("ensureLocalServer reuses healthy locked server", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverDaemonInternals.serverLockPath(server.port, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        port: server.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(
        ensureLocalServer({
          port: server.port,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
        }),
      ).resolves.toEqual({ port: server.port, pid: process.pid, started: false });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer reuses healthy server without lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    try {
      await expect(
        ensureLocalServer({
          port: server.port,
          apiKey: undefined,
          serverEntry: join(process.cwd(), "src/server.ts"),
          homeDir: home,
        }),
      ).resolves.toEqual({ port: server.port, pid: 0, started: false });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer recovers from a stale startup lock with a live owner pid", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();
    const startLockPath = serverDaemonInternals.startupLockPath(port, home);
    await mkdir(join(startLockPath, ".."), { recursive: true });
    await writeFile(startLockPath, String(process.pid), "utf8");
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(startLockPath, staleAt, staleAt);

    const serverEntry = join(home, "status-server.ts");
    await writeFile(
      serverEntry,
      [
        "Bun.serve({",
        "  port: Number(process.env.PORT),",
        "  fetch(request) {",
        '    if (new URL(request.url).pathname === "/v1/status") {',
        `      return Response.json({ ok: true, protocol_version: ${JSON.stringify(PROTOCOL_VERSION)} });`,
        "    }",
        '    return new Response("ok");',
        "  },",
        "});",
      ].join("\n"),
      "utf8",
    );

    let startedPid: number | null = null;
    try {
      const result = await ensureLocalServer({
        port,
        apiKey: undefined,
        serverEntry,
        homeDir: home,
        timeoutMs: 1_500,
      });
      startedPid = result.pid;
      expect(result.port).toBe(port);
      expect(result.started).toBe(true);
      expect(result.pid).toBeGreaterThan(0);
      await expect(Bun.file(startLockPath).exists()).resolves.toBe(false);
    } finally {
      if (startedPid !== null && startedPid > 0) {
        await stopLocalServer({ port, homeDir: home });
      }
    }
  });

  test("ensureLocalServer fails fast when spawned process exits immediately", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();

    const serverEntry = join(home, "crash-server.ts");
    await writeFile(serverEntry, "process.exit(1);", "utf8");

    await expect(
      ensureLocalServer({
        port,
        apiKey: undefined,
        serverEntry,
        homeDir: home,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/exited before becoming healthy/);
  });

  test("ensureLocalServer releases startup lock when spawn throws", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();

    const startLockPath = serverDaemonInternals.startupLockPath(port, home);
    const origExecPath = process.execPath;

    try {
      // Force Bun.spawn to throw ENOENT by using a nonexistent binary
      Object.defineProperty(process, "execPath", { value: "/nonexistent/binary", configurable: true });
      await expect(
        ensureLocalServer({
          port,
          apiKey: undefined,
          serverEntry: "server.ts",
          homeDir: home,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow();
    } finally {
      Object.defineProperty(process, "execPath", { value: origExecPath, configurable: true });
    }

    await expect(Bun.file(startLockPath).exists()).resolves.toBe(false);
  });

  test("stopLocalServer returns false and removes stale lock when endpoint is not healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(9, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await expect(stopLocalServer({ port: 9, homeDir: home })).resolves.toEqual({ stopped: false, pid: null });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("localServerStatus removes lock when status payload is protocol-incompatible", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const staleServer = startTestServer(() => Response.json({ ok: true, protocolVersion: "1" }));
    const lockPath = serverDaemonInternals.serverLockPath(staleServer.port, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        port: staleServer.port,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      await expect(localServerStatus({ port: staleServer.port, homeDir: home })).resolves.toEqual({
        running: false,
        pid: null,
        port: staleServer.port,
      });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
    } finally {
      staleServer.stop();
    }
  });
});
