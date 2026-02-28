import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SERVER_START_TIMEOUT_MS = 10_000;
const HEALTHCHECK_TIMEOUT_MS = 1_200;

type ServerLock = {
  pid: number;
  apiUrl: string;
  port: number;
  startedAt: string;
};

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

function parseServerLock(raw: string): ServerLock | null {
  try {
    const value = JSON.parse(raw) as Partial<ServerLock>;
    const pid = value.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    if (typeof value.apiUrl !== "string" || value.apiUrl.trim().length === 0) return null;
    const port = value.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) return null;
    if (typeof value.startedAt !== "string" || value.startedAt.length === 0) return null;
    return { pid, apiUrl: value.apiUrl, port, startedAt: value.startedAt };
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
  try {
    await writeFile(path, String(process.pid), { flag: "wx" });
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EEXIST") return false;
    throw error;
  }
}

async function releaseStartupLock(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function ensureLocalServer(input: EnsureLocalServerInput): Promise<EnsureLocalServerResult> {
  const apiUrl = input.apiUrl;
  const timeoutMs = input.timeoutMs ?? SERVER_START_TIMEOUT_MS;
  const lockPath = serverLockPath(input.homeDir);
  const startLockPath = startupLockPath(input.homeDir);

  const lock = await readServerLock(lockPath);
  if (lock && lock.apiUrl === apiUrl && isProcessAlive(lock.pid) && (await isServerHealthy(apiUrl, input.apiKey)))
    return { apiUrl, started: false };

  if (lock && (!isProcessAlive(lock.pid) || lock.apiUrl !== apiUrl || !(await isServerHealthy(apiUrl, input.apiKey))))
    await rm(lockPath, { force: true });

  if (await isServerHealthy(apiUrl, input.apiKey)) return { apiUrl, started: false };

  const startupClaimed = await tryAcquireStartupLock(startLockPath);
  if (!startupClaimed) {
    await waitForHealthyServer(apiUrl, input.apiKey, timeoutMs);
    return { apiUrl, started: false };
  }

  const proc = Bun.spawn([process.execPath, "run", input.serverEntry], {
    env: { ...process.env },
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    await waitForHealthyServer(apiUrl, input.apiKey, timeoutMs);
    await writeServerLock(lockPath, {
      pid: proc.pid,
      apiUrl,
      port: input.port,
      startedAt: new Date().toISOString(),
    });
    return { apiUrl, started: true };
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => {});
    throw error;
  } finally {
    await releaseStartupLock(startLockPath);
  }
}

export const serverDaemonInternals = {
  daemonDir,
  serverLockPath,
  startupLockPath,
  parseServerLock,
  isProcessAlive,
};
