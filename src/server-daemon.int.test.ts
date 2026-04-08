import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "./protocol";
import {
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  serverDaemonInternals,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";
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

  test("stopLocalServer stops a healthy server even without a lock file", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const server = startTestServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") {
        server.stop();
        return Response.json({ ok: true });
      }
      return new Response("ok");
    });
    // No lock file written — server is running but lock is missing
    const result = await stopLocalServer({ port: server.port, homeDir: home });
    expect(result.stopped).toBe(true);
  });

  test("stopLocalServer cleans up lock when pid is dead and endpoint is not healthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const lockPath = serverDaemonInternals.serverLockPath(9, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999,
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    await expect(stopLocalServer({ port: 9, homeDir: home })).resolves.toEqual({ stopped: true, pid: 999999 });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("stopLocalServer kills alive process even when endpoint is unhealthy", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    // Start a subprocess that just sleeps
    const proc = Bun.spawn(["sleep", "60"], { detached: true });
    const lockPath = serverDaemonInternals.serverLockPath(9, home);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: proc.pid,
        port: 9,
        startedAt: "2026-02-28T00:00:00.000Z",
      }),
      "utf8",
    );
    try {
      const result = await stopLocalServer({ port: 9, homeDir: home });
      expect(result).toEqual({ stopped: true, pid: proc.pid });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
      // Give SIGTERM a moment to land
      await Bun.sleep(50);
      expect(serverDaemonInternals.isProcessAlive(proc.pid)).toBe(false);
    } finally {
      proc.kill();
      await proc.exited.catch(() => {});
    }
  });

  test("ensureLocalServer gives up after max startup retries", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const reservation = startTestServer(() => new Response("not acolyte"));
    const port = reservation.port;
    reservation.stop();

    // Create a stale startup lock owned by a dead process so each attempt clears it and retries
    const startLockPath = serverDaemonInternals.startupLockPath(port, home);
    await mkdir(join(startLockPath, ".."), { recursive: true });

    // Use a server entry that creates a new startup lock on each spawn (simulating contention)
    const serverEntry = join(home, "lock-stealer.ts");
    await writeFile(
      serverEntry,
      [
        `import { writeFileSync } from "node:fs";`,
        `writeFileSync(${JSON.stringify(startLockPath)}, JSON.stringify({ pid: process.pid, port: ${port}, startedAt: new Date().toISOString() }));`,
        `// Never become healthy — just hold the lock and exit`,
        `process.exit(1);`,
      ].join("\n"),
      "utf8",
    );

    // Pre-create a stale lock so the first attempt can't claim it and enters the wait/retry path
    await writeFile(
      startLockPath,
      JSON.stringify({ pid: 999999, port, startedAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(startLockPath, staleAt, staleAt);

    await expect(
      ensureLocalServer({
        port,
        apiKey: undefined,
        serverEntry,
        homeDir: home,
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
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

  test("stopAllLocalServers stops multiple daemons by lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const dir = serverDaemonInternals.daemonsDir(home);
    await mkdir(dir, { recursive: true });

    const procA = Bun.spawn(["sleep", "60"], { detached: true });
    const procB = Bun.spawn(["sleep", "60"], { detached: true });
    try {
      await writeFile(
        serverDaemonInternals.serverLockPath(9001, home),
        JSON.stringify({ pid: procA.pid, port: 9001, startedAt: "2026-01-01T00:00:00.000Z" }),
      );
      await writeFile(
        serverDaemonInternals.serverLockPath(9002, home),
        JSON.stringify({ pid: procB.pid, port: 9002, startedAt: "2026-01-01T00:00:00.000Z" }),
      );

      const stopped = await stopAllLocalServers({ homeDir: home });
      expect(stopped).toHaveLength(2);
      expect(stopped.map((s) => s.port).sort()).toEqual([9001, 9002]);
    } finally {
      procA.kill();
      procB.kill();
      await procA.exited.catch(() => {});
      await procB.exited.catch(() => {});
    }
  });

  test("listRunningDaemons returns alive daemons and cleans dead locks", async () => {
    const home = await mkdtemp(join(tmpdir(), "acolyte-daemon-home-"));
    const dir = serverDaemonInternals.daemonsDir(home);
    await mkdir(dir, { recursive: true });

    // Alive daemon
    const proc = Bun.spawn(["sleep", "60"], { detached: true });
    await writeFile(
      serverDaemonInternals.serverLockPath(9001, home),
      JSON.stringify({ pid: proc.pid, port: 9001, startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    // Dead daemon
    await writeFile(
      serverDaemonInternals.serverLockPath(9002, home),
      JSON.stringify({ pid: 999999, port: 9002, startedAt: "2026-01-01T00:00:00.000Z" }),
    );

    try {
      const daemons = await listRunningDaemons({ homeDir: home });
      expect(daemons).toHaveLength(1);
      expect(daemons[0]?.pid).toBe(proc.pid);
      // Dead lock should be cleaned up
      await expect(Bun.file(serverDaemonInternals.serverLockPath(9002, home)).exists()).resolves.toBe(false);
    } finally {
      proc.kill();
      await proc.exited.catch(() => {});
    }
  });
});
