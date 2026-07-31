import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearStaleStartupLock,
  DEFAULT_PORT,
  daemonsDir,
  isProcessAlive,
  readServerLock,
  type StartupLock,
  serverLockPath,
  serverLogPath,
  startupLockPath,
  writeServerLock,
} from "./daemon-ops";
import { field } from "./field";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { HTTP_STATUS } from "./http-status";
import { t } from "./i18n";
import type { Env } from "./paths";
import { PROTOCOL_VERSION } from "./protocol";
import { type LiveTask, parseShutdownResponse, type ShutdownRequest } from "./shutdown-contract";

const SERVER_START_TIMEOUT_MS = 10_000;
const SERVER_EXIT_TIMEOUT_MS = 3_000;
const HEALTHCHECK_TIMEOUT_MS = 1_200;
const STARTUP_LOCK_MAX_AGE_MS = 30_000;

type EnsureLocalServerInput = {
  port: number;
  apiKey?: string;
  serverEntry: string;
  env?: Env;
  timeoutMs?: number;
};

type EnsureLocalServerResult = {
  port: number;
  pid: number;
  started: boolean;
};

type LocalServerStatus = {
  running: boolean;
  pid: number | null;
  port: number;
};

export type StopResult =
  | { kind: "stopped"; pid: number | null }
  | { kind: "refused"; tasks: LiveTask[] }
  | { kind: "unresponsive" }
  | { kind: "not_running" };

export function apiUrlForPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function isServerHealthy(apiUrl: string, apiKey?: string, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/status`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return field(payload, "protocol_version") === PROTOCOL_VERSION;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForHealthyServerOrSpawnExit(
  apiUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  proc: { exited: Promise<number>; readonly pid: number },
  logPath: string,
): Promise<void> {
  let exited = false;
  proc.exited.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(t("cli.server.spawn_exited", { logPath }));
    if (await isServerHealthy(apiUrl, apiKey)) return;
    await Bun.sleep(120);
  }
  throw new Error(t("cli.server.start_timeout", { url: apiUrl }));
}

type GracefulShutdownOutcome = { kind: "shutdown" } | { kind: "refused"; tasks: LiveTask[] } | { kind: "unreachable" };

async function waitForServerToExit(
  apiUrl: string,
  apiKey?: string,
  timeoutMs = SERVER_EXIT_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isServerHealthy(apiUrl, apiKey))) return true;
    await Bun.sleep(50);
  }
  return false;
}

async function requestGracefulShutdown(
  apiUrl: string,
  apiKey?: string,
  force = false,
): Promise<GracefulShutdownOutcome> {
  if (!(await isServerHealthy(apiUrl, apiKey))) return { kind: "unreachable" };
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/admin/shutdown`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ force } satisfies ShutdownRequest),
    });
    if (response.status === HTTP_STATUS.unauthorized) return { kind: "unreachable" };
    const decision = parseShutdownResponse(await response.json());
    if (decision && !decision.ok) return { kind: "refused", tasks: decision.running };
  } catch {
    // Server may close before the response completes — that's expected.
  }
  return { kind: "shutdown" };
}

async function tryAcquireStartupLock(path: string, port: number): Promise<boolean> {
  await mkdir(join(path, ".."), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(
        path,
        JSON.stringify({
          pid: process.pid,
          port,
          startedAt: new Date().toISOString(),
        } satisfies StartupLock),
        { flag: "wx", mode: PRIVATE_FILE_MODE },
      );
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EEXIST") throw error;
      const staleCleared = await clearStaleStartupLock(path);
      if (!staleCleared) return false;
    }
  }
  return false;
}

async function releaseStartupLock(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function waitForHealthyServerOrStaleStartupLock(
  apiUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  startLockPath: string,
  staleLockMaxAgeMs = STARTUP_LOCK_MAX_AGE_MS,
): Promise<"healthy" | "retry"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy(apiUrl, apiKey)) return "healthy";
    if (await clearStaleStartupLock(startLockPath, staleLockMaxAgeMs)) return "retry";
    await Bun.sleep(120);
  }
  throw new Error(t("cli.server.start_timeout", { url: apiUrl }));
}

const MAX_STARTUP_RETRIES = 3;

export async function ensureLocalServer(
  input: EnsureLocalServerInput,
  retryCount = 0,
): Promise<EnsureLocalServerResult> {
  const { port, apiKey, serverEntry, env, timeoutMs: inputTimeoutMs } = input;
  const apiUrl = apiUrlForPort(port);
  const timeoutMs = inputTimeoutMs ?? SERVER_START_TIMEOUT_MS;
  const lockPath = serverLockPath(port, env);
  const startLockPath = startupLockPath(port, env);

  const lock = await readServerLock(lockPath);
  if (lock) {
    if (!isProcessAlive(lock.pid)) {
      await rm(lockPath, { force: true });
    } else if (await isServerHealthy(apiUrl, apiKey)) {
      return { port, pid: lock.pid, started: false };
    } else {
      await rm(lockPath, { force: true });
    }
  }

  if (await isServerHealthy(apiUrl, apiKey)) {
    return { port, pid: 0, started: false };
  }

  const startupClaimed = await tryAcquireStartupLock(startLockPath, port);
  if (!startupClaimed) {
    const waitResult = await waitForHealthyServerOrStaleStartupLock(apiUrl, apiKey, timeoutMs, startLockPath);
    if (waitResult === "retry") {
      if (retryCount >= MAX_STARTUP_RETRIES) throw new Error(t("cli.server.start_timeout", { url: apiUrl }));
      return ensureLocalServer(input, retryCount + 1);
    }
    const waitedLock = await readServerLock(lockPath);
    return { port, pid: waitedLock?.pid ?? 0, started: false };
  }

  const logPath = serverLogPath(port, env);
  await mkdir(join(logPath, ".."), { recursive: true });

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const logFd = openSync(logPath, "a", PRIVATE_FILE_MODE);
    try {
      proc = Bun.spawn([process.execPath, "run", serverEntry], {
        env: { ...process.env, PORT: String(port) },
        stdout: logFd,
        stderr: logFd,
        detached: true,
      });
    } finally {
      closeSync(logFd);
    }
    proc.unref();

    await waitForHealthyServerOrSpawnExit(apiUrl, apiKey, timeoutMs, proc, logPath);
    await writeServerLock(lockPath, {
      pid: proc.pid,
      port,
      startedAt: new Date().toISOString(),
    });
    return { port, pid: proc.pid, started: true };
  } catch (error) {
    if (proc) {
      proc.kill();
      await proc.exited.catch(() => {});
    }
    throw error;
  } finally {
    await releaseStartupLock(startLockPath);
  }
}

export async function localServerStatus(input: {
  port: number;
  apiKey?: string;
  env?: Env;
}): Promise<LocalServerStatus> {
  const { port, apiKey, env } = input;
  const apiUrl = apiUrlForPort(port);
  const lockPath = serverLockPath(port, env);
  const lock = await readServerLock(lockPath);

  if (lock) {
    if (!isProcessAlive(lock.pid)) {
      await rm(lockPath, { force: true });
    } else if (await isServerHealthy(apiUrl, apiKey)) {
      return { running: true, pid: lock.pid, port };
    } else {
      await rm(lockPath, { force: true });
    }
  }

  if (await isServerHealthy(apiUrl, apiKey)) {
    return { running: true, pid: null, port };
  }

  return { running: false, pid: null, port };
}

export async function stopLocalServer(input: {
  port: number;
  apiKey?: string;
  env?: Env;
  force?: boolean;
}): Promise<StopResult> {
  const { port, apiKey, env, force = false } = input;
  const apiUrl = apiUrlForPort(port);
  const lockPath = serverLockPath(port, env);
  const lock = await readServerLock(lockPath);

  // Ask before killing: only the daemon knows whether a turn is live, and a signal cannot ask.
  const graceful = await requestGracefulShutdown(apiUrl, apiKey, force);
  if (graceful.kind === "refused") return { kind: "refused", tasks: graceful.tasks };
  if (graceful.kind === "shutdown") {
    // The daemon closes its sockets after answering, and a caller that restarts would otherwise
    // find the old server still healthy and attach to a process about to exit.
    const exited = await waitForServerToExit(apiUrl, apiKey);
    if (exited) {
      await rm(lockPath, { force: true });
      return { kind: "stopped", pid: lock?.pid ?? null };
    }
    // It accepted the request and stayed up; only its own PID can settle this.
    if (!lock) return { kind: "unresponsive" };
  } else if (!lock) {
    // Nothing answered and nothing to signal.
    return { kind: "not_running" };
  }
  try {
    if (isProcessAlive(lock.pid)) process.kill(lock.pid, "SIGTERM");
  } catch {
    // Ignore; lock cleanup still proceeds.
  }
  await rm(lockPath, { force: true });
  return { kind: "stopped", pid: lock.pid };
}

function portFromLockEntry(entry: string): number | undefined {
  if (!entry.endsWith(".lock") || entry.endsWith(".start.lock")) return undefined;
  const stem = entry.replace(".lock", "");
  if (stem === "server") return DEFAULT_PORT;
  const port = Number(stem);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

export async function stopAllLocalServers(input?: {
  apiKey?: string;
  env?: Env;
  force?: boolean;
}): Promise<{ stopped: Array<{ port: number; pid: number }>; refused: Array<{ port: number; tasks: LiveTask[] }> }> {
  const dir = daemonsDir(input?.env);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { stopped: [], refused: [] };
  }

  const stopped: Array<{ port: number; pid: number }> = [];
  const refused: Array<{ port: number; tasks: LiveTask[] }> = [];
  for (const entry of entries) {
    const port = portFromLockEntry(entry);
    if (port === undefined) continue;
    const result = await stopLocalServer({ port, apiKey: input?.apiKey, env: input?.env, force: input?.force });
    if (result.kind === "refused") refused.push({ port, tasks: result.tasks });
    else if (result.kind === "stopped" && result.pid !== null) stopped.push({ port, pid: result.pid });
  }
  return { stopped, refused };
}

export async function listRunningDaemons(input?: {
  env?: Env;
}): Promise<Array<{ port: number; pid: number; startedAt: string }>> {
  const dir = daemonsDir(input?.env);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const daemons: Array<{ port: number; pid: number; startedAt: string }> = [];
  for (const entry of entries) {
    const port = portFromLockEntry(entry);
    if (port === undefined) continue;
    const lockPath = serverLockPath(port, input?.env);
    const lock = await readServerLock(lockPath);
    if (!lock) continue;
    if (!isProcessAlive(lock.pid)) {
      await rm(lockPath, { force: true });
      continue;
    }
    daemons.push({ port: lock.port, pid: lock.pid, startedAt: lock.startedAt });
  }
  return daemons.sort((a, b) => a.port - b.port);
}
