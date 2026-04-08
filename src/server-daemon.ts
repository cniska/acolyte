import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  clearStaleStartupLock,
  daemonsDir,
  isProcessAlive,
  readServerLock,
  type StartupLock,
  serverLockPath,
  serverLogPath,
  startupLockPath,
  writeServerLock,
} from "./daemon-ops";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { t } from "./i18n";
import { PROTOCOL_VERSION } from "./protocol";

const SERVER_START_TIMEOUT_MS = 10_000;
const HEALTHCHECK_TIMEOUT_MS = 1_200;
const STARTUP_LOCK_MAX_AGE_MS = 30_000;

// Re-export for external consumers (cli-daemon.ts, etc.)
export { serverLogPath } from "./daemon-ops";

type EnsureLocalServerInput = {
  port: number;
  apiKey?: string;
  serverEntry: string;
  homeDir?: string;
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

type StopResult = {
  stopped: boolean;
  pid: number | null;
};

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
    if (!payload || typeof payload !== "object") return false;
    const protocolVersion =
      "protocol_version" in payload ? (payload as { protocol_version?: unknown }).protocol_version : undefined;
    return protocolVersion === PROTOCOL_VERSION;
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

async function requestGracefulShutdown(apiUrl: string, apiKey?: string): Promise<boolean> {
  if (!(await isServerHealthy(apiUrl, apiKey))) return false;
  try {
    await fetch(`${apiUrl.replace(/\/$/, "")}/v1/admin/shutdown`, {
      method: "POST",
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    });
  } catch {
    // Server may close before the response completes — that's expected.
  }
  return true;
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

// 6        7
// \_(ᴗ _ᴗ)_/
const DEFAULT_PORT = 6767;

const MAX_STARTUP_RETRIES = 3;

export async function ensureLocalServer(
  input: EnsureLocalServerInput,
  retryCount = 0,
): Promise<EnsureLocalServerResult> {
  const { port, apiKey, serverEntry, homeDir, timeoutMs: inputTimeoutMs } = input;
  const apiUrl = apiUrlForPort(port);
  const timeoutMs = inputTimeoutMs ?? SERVER_START_TIMEOUT_MS;
  const lockPath = serverLockPath(port, homeDir);
  const startLockPath = startupLockPath(port, homeDir);

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

  const logPath = serverLogPath(port, homeDir);
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
  homeDir?: string;
}): Promise<LocalServerStatus> {
  const { port, apiKey, homeDir } = input;
  const apiUrl = apiUrlForPort(port);
  const lockPath = serverLockPath(port, homeDir);
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

export async function stopLocalServer(input: { port: number; apiKey?: string; homeDir?: string }): Promise<StopResult> {
  const { port, apiKey, homeDir } = input;
  const apiUrl = apiUrlForPort(port);
  const lockPath = serverLockPath(port, homeDir);
  const lock = await readServerLock(lockPath);

  if (!lock) {
    if (await requestGracefulShutdown(apiUrl, apiKey)) return { stopped: true, pid: null };
    return { stopped: false, pid: null };
  }

  try {
    if (isProcessAlive(lock.pid)) process.kill(lock.pid, "SIGTERM");
  } catch {
    // Ignore; lock cleanup still proceeds.
  }
  await rm(lockPath, { force: true });
  // If the lock PID was dead but a server is still healthy (stale lock), shut it down.
  if (!isProcessAlive(lock.pid)) await requestGracefulShutdown(apiUrl, apiKey);
  return { stopped: true, pid: lock.pid };
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
  homeDir?: string;
}): Promise<Array<{ port: number; pid: number }>> {
  const dir = daemonsDir(input?.homeDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const stopped: Array<{ port: number; pid: number }> = [];
  for (const entry of entries) {
    const port = portFromLockEntry(entry);
    if (port === undefined) continue;
    const result = await stopLocalServer({ port, apiKey: input?.apiKey, homeDir: input?.homeDir });
    if (result.stopped && result.pid !== null) {
      stopped.push({ port, pid: result.pid });
    }
  }
  return stopped;
}

export async function listRunningDaemons(input?: {
  homeDir?: string;
}): Promise<Array<{ port: number; pid: number; startedAt: string }>> {
  const dir = daemonsDir(input?.homeDir);
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
    const lockPath = serverLockPath(port, input?.homeDir);
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
