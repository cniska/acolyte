import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { stateDir } from "./paths";

const DEFAULT_PORT = 6767;

export type ServerLock = {
  pid: number;
  port: number;
  startedAt: IsoDateTimeString;
};

export type StartupLock = {
  pid: number;
  port: number;
  startedAt: IsoDateTimeString;
};

const serverLockSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
});

const startupLockSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  startedAt: isoDateTimeSchema,
});

function resolveStateDir(homeDir?: string): string {
  return homeDir ? join(homeDir, ".acolyte") : stateDir();
}

export function daemonsDir(homeDir?: string): string {
  return join(resolveStateDir(homeDir), "daemons");
}

function daemonFileName(port: number, suffix: string): string {
  return port === DEFAULT_PORT ? `server${suffix}` : `${port}${suffix}`;
}

export function serverLockPath(port: number, homeDir?: string): string {
  return join(daemonsDir(homeDir), daemonFileName(port, ".lock"));
}

export function startupLockPath(port: number, homeDir?: string): string {
  return join(daemonsDir(homeDir), daemonFileName(port, ".start.lock"));
}

export function serverLogPath(port: number, homeDir?: string): string {
  return join(daemonsDir(homeDir), daemonFileName(port, ".log"));
}

export function parseServerLock(raw: string): ServerLock | null {
  try {
    const value = JSON.parse(raw);
    const parsed = serverLockSchema.safeParse(value);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function readServerLock(path: string): Promise<ServerLock | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseServerLock(raw);
  } catch {
    return null;
  }
}

export async function writeServerLock(path: string, lock: ServerLock): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(lock), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readStartupLock(path: string): Promise<StartupLock | number | null> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    const parsedPid = Number(raw);
    if (Number.isInteger(parsedPid) && parsedPid > 0) return parsedPid;
    const parsedJson = startupLockSchema.safeParse(JSON.parse(raw));
    if (parsedJson.success) return parsedJson.data;
  } catch {
    return null;
  }
  return null;
}

export async function startupLockAgeMs(path: string, lock: StartupLock | number): Promise<number | null> {
  if (typeof lock !== "number") {
    const startedAt = Date.parse(lock.startedAt);
    if (Number.isFinite(startedAt)) return Math.max(0, Date.now() - startedAt);
  }
  try {
    const file = await stat(path);
    return Math.max(0, Date.now() - file.mtimeMs);
  } catch {
    return null;
  }
}

export async function clearStaleStartupLock(path: string, maxAgeMs?: number): Promise<boolean> {
  const lock = await readStartupLock(path);
  const ownerPid = typeof lock === "number" ? lock : (lock?.pid ?? null);
  if (lock !== null && ownerPid && isProcessAlive(ownerPid)) {
    if (maxAgeMs === undefined) return false;
    const ageMs = await startupLockAgeMs(path, lock);
    if (ageMs === null || ageMs < maxAgeMs) return false;
  }
  if (lock === null && (await Bun.file(path).exists()) === false) return false;
  await rm(path, { force: true });
  return true;
}
