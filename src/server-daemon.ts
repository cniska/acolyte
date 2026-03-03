import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";

const SERVER_START_TIMEOUT_MS = 10_000;
const HEALTHCHECK_TIMEOUT_MS = 1_200;

type ServerLock = {
  pid: number;
  apiUrl: string;
  port: number;
  startedAt: IsoDateTimeString;
};

const serverLockSchema = z.object({
  pid: z.number().int().positive(),
  apiUrl: z.string().trim().min(1),
  port: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
});

type EnsureLocalServerInput = {
  apiUrl: string;
  port: number;
  apiKey?: string;
  serverEntry: string;
  homeDir?: string;
  timeoutMs?: number;
};

type EnsureLocalServerResult = {
  apiUrl: string;
  started: boolean;
  managed: boolean;
};

type LocalServerStatus = {
  running: boolean;
  pid: number | null;
  apiUrl: string | null;
  managed: boolean;
};

function daemonDir(homeDir = homedir()): string {
  return join(homeDir, ".acolyte");
}

function serverLockPath(homeDir = homedir()): string {
  return join(daemonDir(homeDir), "server.lock");
}

function startupLockPath(homeDir = homedir()): string {
  return join(daemonDir(homeDir), "server.start.lock");
}

function serverLogPath(homeDir = homedir()): string {
  return join(daemonDir(homeDir), "server.log");
}

function parseServerLock(raw: string): ServerLock | null {
  try {
    const value = JSON.parse(raw);
    const parsed = serverLockSchema.safeParse(value);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function readServerLock(path: string): Promise<ServerLock | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseServerLock(raw);
  } catch {
    return null;
  }
}

async function writeServerLock(path: string, lock: ServerLock): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(lock), "utf8");
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isServerHealthy(apiUrl: string, apiKey?: string, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/status`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForHealthyServer(apiUrl: string, apiKey: string | undefined, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy(apiUrl, apiKey)) return;
    await Bun.sleep(120);
  }
  throw new Error(`Timed out waiting for server at ${apiUrl}`);
}

async function tryAcquireStartupLock(path: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, String(process.pid), { flag: "wx" });
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

async function clearStaleStartupLock(path: string): Promise<boolean> {
  let ownerPid: number | null = null;
  try {
    const raw = (await readFile(path, "utf8")).trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) ownerPid = parsed;
  } catch {
    // If we can't read/parse lock owner, treat it as stale and try removing it.
  }
  if (ownerPid && isProcessAlive(ownerPid)) return false;
  await rm(path, { force: true });
  return true;
}

export async function ensureLocalServer(input: EnsureLocalServerInput): Promise<EnsureLocalServerResult> {
  const apiUrl = input.apiUrl;
  const timeoutMs = input.timeoutMs ?? SERVER_START_TIMEOUT_MS;
  const lockPath = serverLockPath(input.homeDir);
  const startLockPath = startupLockPath(input.homeDir);

  const lock = await readServerLock(lockPath);
  if (lock) {
    if (!isProcessAlive(lock.pid)) await rm(lockPath, { force: true });
    else {
      const lockHealthy = await isServerHealthy(lock.apiUrl, input.apiKey);
      if (!lockHealthy) await rm(lockPath, { force: true });
      else if (lock.apiUrl === apiUrl) return { apiUrl, started: false, managed: true };
      else if (!(await isServerHealthy(apiUrl, input.apiKey))) {
        // Replace the old managed daemon only when switching to a different, currently-unhealthy target.
        if (lock.pid !== process.pid) {
          try {
            process.kill(lock.pid, "SIGTERM");
          } catch {
            // Best effort; stale lock cleanup still proceeds.
          }
        }
        await rm(lockPath, { force: true });
      }
    }
  }

  if (await isServerHealthy(apiUrl, input.apiKey)) return { apiUrl, started: false, managed: false };

  const startupClaimed = await tryAcquireStartupLock(startLockPath);
  if (!startupClaimed) {
    await waitForHealthyServer(apiUrl, input.apiKey, timeoutMs);
    const waitedLock = await readServerLock(lockPath);
    const managed =
      !!waitedLock &&
      waitedLock.apiUrl === apiUrl &&
      isProcessAlive(waitedLock.pid) &&
      (await isServerHealthy(apiUrl, input.apiKey));
    return { apiUrl, started: false, managed };
  }

  const logPath = serverLogPath(input.homeDir);
  await mkdir(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  const proc = Bun.spawn([process.execPath, "run", input.serverEntry], {
    env: { ...process.env },
    stdout: logFd,
    stderr: logFd,
    detached: true,
  });
  closeSync(logFd);
  proc.unref();

  try {
    await waitForHealthyServer(apiUrl, input.apiKey, timeoutMs);
    await writeServerLock(lockPath, {
      pid: proc.pid,
      apiUrl,
      port: input.port,
      startedAt: new Date().toISOString(),
    });
    return { apiUrl, started: true, managed: true };
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => {});
    throw error;
  } finally {
    await releaseStartupLock(startLockPath);
  }
}

export async function localServerStatus(input?: {
  homeDir?: string;
  apiKey?: string;
  apiUrl?: string;
}): Promise<LocalServerStatus> {
  const fallbackToTargetStatus = async (): Promise<LocalServerStatus> => {
    if (input?.apiUrl && (await isServerHealthy(input.apiUrl, input.apiKey)))
      return { running: true, pid: null, apiUrl: input.apiUrl, managed: false };
    return { running: false, pid: null, apiUrl: null, managed: false };
  };

  const lockPath = serverLockPath(input?.homeDir);
  const lock = await readServerLock(lockPath);
  if (!lock) return fallbackToTargetStatus();
  if (!isProcessAlive(lock.pid)) {
    await rm(lockPath, { force: true });
    return fallbackToTargetStatus();
  }
  if (!(await isServerHealthy(lock.apiUrl, input?.apiKey))) {
    await rm(lockPath, { force: true });
    return fallbackToTargetStatus();
  }
  if (input?.apiUrl && lock.apiUrl !== input.apiUrl) return fallbackToTargetStatus();
  return { running: true, pid: lock.pid, apiUrl: lock.apiUrl, managed: true };
}

export async function stopLocalServer(input?: { homeDir?: string; apiKey?: string }): Promise<boolean> {
  const lockPath = serverLockPath(input?.homeDir);
  const lock = await readServerLock(lockPath);
  if (!lock) return false;
  const healthy = await isServerHealthy(lock.apiUrl, input?.apiKey);
  if (!healthy) {
    await rm(lockPath, { force: true });
    return false;
  }
  try {
    if (isProcessAlive(lock.pid)) process.kill(lock.pid, "SIGTERM");
  } catch {
    // Ignore; lock cleanup still proceeds.
  }
  await rm(lockPath, { force: true });
  return true;
}

export const serverDaemonInternals = {
  daemonDir,
  serverLockPath,
  startupLockPath,
  serverLogPath,
  parseServerLock,
  isProcessAlive,
  clearStaleStartupLock,
};
