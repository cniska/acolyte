import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearStaleStartupLock, daemonsDir, isProcessAlive, serverLockPath, startupLockPath } from "./daemon-ops";
import type { Env } from "./paths";
import { PROTOCOL_VERSION } from "./protocol";
import {
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";
import { serverSpawnCommand } from "./server-spawn";
import { startTestServer, tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function compatibleStatusResponse(): Response {
  return Response.json({ ok: true, protocol_version: PROTOCOL_VERSION });
}

function testEnv(homeDir: string): Env {
  return { HOME: homeDir };
}

describe("server daemon", () => {
  test("clearStaleStartupLock removes invalid owner lock", async () => {
    const dir = dirs.createDir("acolyte-daemon-lock-");
    const path = join(dir, "6767.start.lock");
    await writeFile(path, "not-a-pid", "utf8");
    await expect(clearStaleStartupLock(path)).resolves.toBe(true);
    await expect(Bun.file(path).exists()).resolves.toBe(false);
  });

  test("clearStaleStartupLock keeps lock when owner process is alive", async () => {
    const dir = dirs.createDir("acolyte-daemon-lock-");
    const path = join(dir, "6767.start.lock");
    await writeFile(path, String(process.pid), "utf8");
    await expect(clearStaleStartupLock(path)).resolves.toBe(false);
    await expect(Bun.file(path).exists()).resolves.toBe(true);
  });

  test("localServerStatus removes stale server lock when endpoint is not healthy", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const lockPath = serverLockPath(9, env);
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
    await expect(localServerStatus({ port: 9, env })).resolves.toEqual({
      running: false,
      pid: null,
      port: 9,
    });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("localServerStatus reports running when lock and server are healthy", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverLockPath(server.port, env);
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
      await expect(localServerStatus({ port: server.port, env })).resolves.toEqual({
        running: true,
        pid: process.pid,
        port: server.port,
      });
    } finally {
      server.stop();
    }
  });

  test("localServerStatus removes lock when pid is dead", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverLockPath(server.port, env);
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
      await expect(localServerStatus({ port: server.port, env })).resolves.toEqual({
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
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    await expect(localServerStatus({ port: 9, env })).resolves.toEqual({
      running: false,
      pid: null,
      port: 9,
    });
  });

  test("ensureLocalServer reuses healthy locked server", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    const lockPath = serverLockPath(server.port, env);
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
          spawnCommand: serverSpawnCommand(),
          env,
        }),
      ).resolves.toEqual({ port: server.port, pid: process.pid, started: false });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer reuses healthy server without lock", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer(() => compatibleStatusResponse());
    try {
      await expect(
        ensureLocalServer({
          port: server.port,
          apiKey: undefined,
          spawnCommand: serverSpawnCommand(),
          env,
        }),
      ).resolves.toEqual({ port: server.port, pid: 0, started: false });
    } finally {
      server.stop();
    }
  });

  test("ensureLocalServer recovers from a stale startup lock with a live owner pid", async () => {
    const home = dirs.createDir("acolyte-daemon-home-");
    const env = testEnv(home);
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();
    const startLockPath = startupLockPath(port, env);
    await mkdir(join(startLockPath, ".."), { recursive: true });
    await writeFile(startLockPath, String(process.pid), "utf8");
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(startLockPath, staleAt, staleAt);

    const spawnEntry = join(home, "status-server.ts");
    await writeFile(
      spawnEntry,
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
        spawnCommand: [process.execPath, "run", spawnEntry],
        env,
        timeoutMs: 1_500,
      });
      startedPid = result.pid;
      expect(result.port).toBe(port);
      expect(result.started).toBe(true);
      expect(result.pid).toBeGreaterThan(0);
      await expect(Bun.file(startLockPath).exists()).resolves.toBe(false);
    } finally {
      if (startedPid !== null && startedPid > 0) {
        await stopLocalServer({ port, env });
      }
    }
  });

  test("ensureLocalServer fails fast when spawned process exits immediately", async () => {
    const home = dirs.createDir("acolyte-daemon-home-");
    const env = testEnv(home);
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();

    const spawnEntry = join(home, "crash-server.ts");
    await writeFile(spawnEntry, "process.exit(1);", "utf8");

    await expect(
      ensureLocalServer({
        port,
        apiKey: undefined,
        spawnCommand: [process.execPath, "run", spawnEntry],
        env,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/exited before becoming healthy/);
  });

  test("ensureLocalServer releases startup lock when spawn throws", async () => {
    const home = dirs.createDir("acolyte-daemon-home-");
    const env = testEnv(home);
    const reservation = startTestServer(() => new Response("reserved"));
    const port = reservation.port;
    reservation.stop();

    const startLockPath = startupLockPath(port, env);

    await expect(
      ensureLocalServer({
        port,
        apiKey: undefined,
        spawnCommand: ["/nonexistent/binary"],
        env,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow();

    await expect(Bun.file(startLockPath).exists()).resolves.toBe(false);
  });

  test("stopLocalServer stops a healthy server even without a lock file", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") {
        setTimeout(() => server.stop(), 0);
        return Response.json({ ok: true, shutdown: true });
      }
      return new Response("ok");
    });
    // No lock file written — server is running but lock is missing
    const result = await stopLocalServer({ port: server.port, env });
    expect(result.kind).toBe("stopped");
  });

  test("stopLocalServer asks before signalling, so a live turn survives with its lock intact", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const live = [{ taskId: "task_abc", sessionId: "sess_xyz" }];
    let signalled = false;
    // A process that outlives the test stands in for the daemon, so a stray SIGTERM is observable.
    const proc = Bun.spawn(["sleep", "60"], { detached: true });
    const server = startTestServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") {
        return Response.json({ ok: false, live }, { status: 409 });
      }
      return new Response("ok");
    });
    const lockPath = serverLockPath(server.port, env);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: proc.pid, port: server.port, startedAt: "2026-02-28T00:00:00.000Z" }),
      "utf8",
    );

    try {
      const result = await stopLocalServer({ port: server.port, env });

      expect(result).toEqual({ kind: "refused", tasks: live });
      await Bun.sleep(50);
      signalled = !isProcessAlive(proc.pid);
      expect(signalled).toBe(false);
      // The daemon is still the owner of that port, so its lock must not be cleaned up.
      await expect(Bun.file(lockPath).exists()).resolves.toBe(true);
    } finally {
      server.stop();
      proc.kill();
      await proc.exited.catch(() => {});
    }
  });

  test("stopLocalServer with force stops a daemon that would otherwise refuse", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const forced: boolean[] = [];
    const server = startTestServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") {
        const body = (await req.json()) as { force?: boolean };
        forced.push(body.force ?? false);
        if (!body.force)
          return Response.json({ ok: false, live: [{ taskId: "task_abc", sessionId: null }] }, { status: 409 });
        // A forced shutdown really exits, which is what the caller waits for.
        setTimeout(() => server.stop(), 0);
        return Response.json({ ok: true, shutdown: true });
      }
      return new Response("ok");
    });

    try {
      const result = await stopLocalServer({ port: server.port, env, force: true });

      expect(forced).toEqual([true]);
      expect(result.kind).toBe("stopped");
    } finally {
      server.stop();
    }
  });

  test("stopLocalServer reports unresponsive when the daemon accepts shutdown but stays up", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const server = startTestServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") return Response.json({ ok: true, shutdown: true });
      return new Response("ok");
    });

    try {
      // No lock file, so there is no pid to escalate to when it does not exit.
      await expect(stopLocalServer({ port: server.port, env, exitTimeoutMs: 300 })).resolves.toEqual({
        kind: "unresponsive",
      });
    } finally {
      server.stop();
    }
  });

  // Regression: a daemon that holds the port but never answers the shutdown request used to
  // report as `not_running`, so `acolyte stop` said "No servers running" and exited zero while
  // the process was still up.
  test("stopLocalServer reports unresponsive when the daemon holds the port but never answers", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          if (data.toString().startsWith("GET /healthz")) {
            socket.write("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok");
            socket.flush();
            return;
          }
          socket.end();
        },
      },
    });

    try {
      // No lock file, so the port itself is the only evidence the daemon is there.
      await expect(stopLocalServer({ port: listener.port, env, exitTimeoutMs: 300 })).resolves.toEqual({
        kind: "unresponsive",
      });
    } finally {
      listener.stop(true);
    }
  });

  test("stopLocalServer cleans up lock when pid is dead and endpoint is not healthy", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const lockPath = serverLockPath(9, env);
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
    // Nothing answers and the lock's owner is gone: there was no daemon to stop.
    await expect(stopLocalServer({ port: 9, env })).resolves.toEqual({ kind: "not_running" });
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("stopLocalServer shuts down healthy server when lock pid is dead", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    let shutdownCalled = false;
    const server = startTestServer((req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/status") return compatibleStatusResponse();
      if (url.pathname === "/v1/admin/shutdown") {
        shutdownCalled = true;
        setTimeout(() => server.stop(), 0);
        return Response.json({ ok: true, shutdown: true });
      }
      return new Response("ok");
    });
    // Lock exists but its PID is dead — server is actually running on the port
    const lockPath = serverLockPath(server.port, env);
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, port: server.port, startedAt: "2026-02-28T00:00:00.000Z" }),
      "utf8",
    );
    const result = await stopLocalServer({ port: server.port, env });
    expect(result.kind).toBe("stopped");
    expect(shutdownCalled).toBe(true);
  });

  test("stopLocalServer kills alive process even when endpoint is unhealthy", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const proc = Bun.spawn(["sleep", "60"], { detached: true });
    const lockPath = serverLockPath(9, env);
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
      const result = await stopLocalServer({ port: 9, env });
      expect(result).toEqual({ kind: "stopped", pid: proc.pid });
      await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
      await Bun.sleep(50);
      expect(isProcessAlive(proc.pid)).toBe(false);
    } finally {
      proc.kill();
      await proc.exited.catch(() => {});
    }
  });

  test("ensureLocalServer gives up after max startup retries", async () => {
    const home = dirs.createDir("acolyte-daemon-home-");
    const env = testEnv(home);
    const reservation = startTestServer(() => new Response("not acolyte"));
    const port = reservation.port;
    reservation.stop();

    const startLockPath = startupLockPath(port, env);
    await mkdir(join(startLockPath, ".."), { recursive: true });

    const spawnEntry = join(home, "lock-stealer.ts");
    await writeFile(
      spawnEntry,
      [
        `import { writeFileSync } from "node:fs";`,
        `writeFileSync(${JSON.stringify(startLockPath)}, JSON.stringify({ pid: process.pid, port: ${port}, startedAt: new Date().toISOString() }));`,
        `process.exit(1);`,
      ].join("\n"),
      "utf8",
    );

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
        spawnCommand: [process.execPath, "run", spawnEntry],
        env,
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow();
  });

  test("localServerStatus removes lock when status payload is protocol-incompatible", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const staleServer = startTestServer(() => Response.json({ ok: true, protocolVersion: "1" }));
    const lockPath = serverLockPath(staleServer.port, env);
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
      await expect(localServerStatus({ port: staleServer.port, env })).resolves.toEqual({
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
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const dir = daemonsDir(env);
    await mkdir(dir, { recursive: true });

    const procA = Bun.spawn(["sleep", "60"], { detached: true });
    const procB = Bun.spawn(["sleep", "60"], { detached: true });
    try {
      await writeFile(
        serverLockPath(9001, env),
        JSON.stringify({ pid: procA.pid, port: 9001, startedAt: "2026-01-01T00:00:00.000Z" }),
      );
      await writeFile(
        serverLockPath(9002, env),
        JSON.stringify({ pid: procB.pid, port: 9002, startedAt: "2026-01-01T00:00:00.000Z" }),
      );

      const results = await stopAllLocalServers({ env });
      expect(results).toHaveLength(2);
      expect(results.map((entry) => entry.port).sort()).toEqual([9001, 9002]);
      expect(results.every((entry) => entry.result.kind === "stopped")).toBe(true);
    } finally {
      procA.kill();
      procB.kill();
      await procA.exited.catch(() => {});
      await procB.exited.catch(() => {});
    }
  });

  test("listRunningDaemons returns alive daemons and cleans dead locks", async () => {
    const env = testEnv(dirs.createDir("acolyte-daemon-home-"));
    const dir = daemonsDir(env);
    await mkdir(dir, { recursive: true });

    const proc = Bun.spawn(["sleep", "60"], { detached: true });
    await writeFile(
      serverLockPath(9001, env),
      JSON.stringify({ pid: proc.pid, port: 9001, startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    await writeFile(
      serverLockPath(9002, env),
      JSON.stringify({ pid: 999999, port: 9002, startedAt: "2026-01-01T00:00:00.000Z" }),
    );

    try {
      const daemons = await listRunningDaemons({ env });
      expect(daemons).toHaveLength(1);
      expect(daemons[0]?.pid).toBe(proc.pid);
      await expect(Bun.file(serverLockPath(9002, env)).exists()).resolves.toBe(false);
    } finally {
      proc.kill();
      await proc.exited.catch(() => {});
    }
  });
});
