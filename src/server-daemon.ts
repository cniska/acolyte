import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatVersionWithCommit, resolveCliCommitShort, resolveCliVersion } from "./cli-version";
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
const SHUTDOWN_REQUEST_TIMEOUT_MS = 5_000;
const HEALTHCHECK_TIMEOUT_MS = 1_200;
const STARTUP_LOCK_MAX_AGE_MS = 30_000;

type EnsureLocalServerInput = {
  port: number;
  apiKey?: string;
  spawnCommand: string[];
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

type ServerIdentity = { protocolVersion: unknown; build: unknown };

let localBuildIdentity: string | undefined;

/** The protocol version is per release line, so it cannot tell a freshly launched update from the
 *  daemon the build before it left running. The build identity can. */
function localBuild(): string {
  localBuildIdentity ??= formatVersionWithCommit(resolveCliVersion(), resolveCliCommitShort());
  return localBuildIdentity;
}

async function readServerIdentity(
  apiUrl: string,
  apiKey?: string,
  timeoutMs = HEALTHCHECK_TIMEOUT_MS,
): Promise<ServerIdentity | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/status`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return { protocolVersion: field(payload, "protocol_version"), build: field(payload, "build") };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** A daemon this client can talk to, whichever build it was started from. */
async function isServerHealthy(apiUrl: string, apiKey?: string, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<boolean> {
  const identity = await readServerIdentity(apiUrl, apiKey, timeoutMs);
  return identity?.protocolVersion === PROTOCOL_VERSION;
}

/** A daemon this client may serve requests through: same protocol and the same build. */
async function isServerReusable(apiUrl: string, apiKey?: string, timeoutMs = HEALTHCHECK_TIMEOUT_MS): Promise<boolean> {
  const identity = await readServerIdentity(apiUrl, apiKey, timeoutMs);
  return identity?.protocolVersion === PROTOCOL_VERSION && identity.build === localBuild();
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

type GracefulShutdownOutcome =
  | { kind: "shutdown" }
  | { kind: "refused"; tasks: LiveTask[] }
  | { kind: "unauthorized" }
  | { kind: "unresponsive" }
  | { kind: "unreachable" };

/** Anything that answers means a daemon still holds the port, whatever its version or auth. */
async function isServerListening(apiUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
  try {
    await fetch(`${apiUrl.replace(/\/$/, "")}/healthz`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForServerToExit(apiUrl: string, timeoutMs = SERVER_EXIT_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isServerListening(apiUrl))) return true;
    await Bun.sleep(50);
  }
  return false;
}

async function waitForProcessToExit(pid: number, timeoutMs = SERVER_EXIT_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await Bun.sleep(50);
  }
  return false;
}

/** Only the daemon we set out to stop owns this lock; a replacement that took the port keeps its own. */
async function removeOwnedServerLock(lockPath: string, owner: StartupLock | null): Promise<void> {
  if (!owner) return;
  const current = await readServerLock(lockPath);
  if (current && current.pid !== owner.pid) return;
  await rm(lockPath, { force: true });
}

async function requestGracefulShutdown(
  apiUrl: string,
  apiKey?: string,
  force = false,
): Promise<GracefulShutdownOutcome> {
  // Liveness only, never `/v1/status`: that payload is slowest to build exactly when a turn is
  // running, and a preflight that timed out would turn the refusal this request exists to collect
  // into a signal. `/healthz` needs no auth and no version match, so it answers or nothing is there.
  if (!(await isServerListening(apiUrl))) return { kind: "unreachable" };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SHUTDOWN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/admin/shutdown`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ force } satisfies ShutdownRequest),
      signal: controller.signal,
    });
    if (response.status === HTTP_STATUS.unauthorized) return { kind: "unauthorized" };
    // The status is ours, so a refusal stays a refusal even when its body cannot be read.
    if (response.status === HTTP_STATUS.conflict) {
      const decision = parseShutdownResponse(await response.json().catch(() => null));
      return { kind: "refused", tasks: decision && !decision.ok ? decision.live : [] };
    }
    return { kind: "shutdown" };
  } catch {
    // A daemon may close the socket before its reply lands; if the port is free now, it stopped.
    return (await isServerListening(apiUrl)) ? { kind: "unresponsive" } : { kind: "shutdown" };
  } finally {
    clearTimeout(timeoutId);
  }
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
  const { port, apiKey, spawnCommand, env, timeoutMs: inputTimeoutMs } = input;
  const apiUrl = apiUrlForPort(port);
  const timeoutMs = inputTimeoutMs ?? SERVER_START_TIMEOUT_MS;
  const lockPath = serverLockPath(port, env);
  const startLockPath = startupLockPath(port, env);

  const lock = await readServerLock(lockPath);
  if (lock && !isProcessAlive(lock.pid)) await rm(lockPath, { force: true });

  if (await isServerReusable(apiUrl, apiKey)) {
    const reusedLock = await readServerLock(lockPath);
    return { port, pid: reusedLock?.pid ?? 0, started: false };
  }

  // Whatever answers here belongs to another build or another protocol, and the port is the one
  // thing it cannot share. Asking it to stop leaves a live turn alone, and a daemon that keeps one
  // running keeps the port too, so this client serves through it until that turn is done.
  if (await isServerListening(apiUrl)) {
    const stopped = await stopLocalServer({ port, apiKey, env });
    // Refused means a turn is live; unresponsive means it outlived the signal. Either way it still
    // holds the port, and serving through it beats failing the client outright. A daemon that did
    // stop took its own lock with it, so nothing here removes one it may no longer own.
    if (stopped.kind === "refused" || stopped.kind === "unresponsive") {
      const heldLock = await readServerLock(lockPath);
      return { port, pid: heldLock?.pid ?? 0, started: false };
    }
  }

  const startupClaimed = await tryAcquireStartupLock(startLockPath, port);
  if (!startupClaimed) {
    const waitResult = await waitForHealthyServerOrStaleStartupLock(apiUrl, apiKey, timeoutMs, startLockPath);
    if (waitResult === "retry" || !(await isServerReusable(apiUrl, apiKey))) {
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
      proc = Bun.spawn(spawnCommand, {
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
  exitTimeoutMs?: number;
}): Promise<StopResult> {
  const { port, apiKey, env, force = false, exitTimeoutMs } = input;
  const apiUrl = apiUrlForPort(port);
  const lockPath = serverLockPath(port, env);
  const lock = await readServerLock(lockPath);

  // Ask before killing: only the daemon knows whether a turn is live, and a signal cannot ask.
  const graceful = await requestGracefulShutdown(apiUrl, apiKey, force);
  if (graceful.kind === "refused") return { kind: "refused", tasks: graceful.tasks };
  if (graceful.kind === "shutdown" && (await waitForServerToExit(apiUrl, exitTimeoutMs))) {
    await removeOwnedServerLock(lockPath, lock);
    return { kind: "stopped", pid: lock?.pid ?? null };
  }

  // It never answered, could not be authenticated, or accepted the request and stayed up. Its own
  // pid is the only lever left, and `unreachable` is the only outcome that means nothing is there.
  const nothingThere = graceful.kind === "unreachable";
  if (!lock) return nothingThere ? { kind: "not_running" } : { kind: "unresponsive" };
  if (!isProcessAlive(lock.pid)) {
    await removeOwnedServerLock(lockPath, lock);
    return nothingThere ? { kind: "not_running" } : { kind: "stopped", pid: lock.pid };
  }
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // Ignore; the exit check below decides the outcome.
  }
  if (!(await waitForProcessToExit(lock.pid, exitTimeoutMs))) return { kind: "unresponsive" };
  await removeOwnedServerLock(lockPath, lock);
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
}): Promise<Array<{ port: number; result: StopResult }>> {
  const dir = daemonsDir(input?.env);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  // Every outcome travels back, including the ones that stopped nothing: a caller that sees only
  // its successes reports a daemon it left running as a clean stop.
  const results: Array<{ port: number; result: StopResult }> = [];
  for (const entry of entries) {
    const port = portFromLockEntry(entry);
    if (port === undefined) continue;
    results.push({
      port,
      result: await stopLocalServer({ port, apiKey: input?.apiKey, env: input?.env, force: input?.force }),
    });
  }
  return results;
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
