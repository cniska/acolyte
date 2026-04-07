import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVATE_FILE_MODE } from "./file-ops";
import { resolveHomeDir } from "./home-dir";

type LockOptions = {
  homeDir?: string;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function locksDir(options?: LockOptions): string {
  return join(options?.homeDir ?? resolveHomeDir(), ".acolyte", "locks");
}

function lockPathForSession(sessionId: string, options?: LockOptions): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(locksDir(options), `${safe}.lock`);
}

export function acquireSessionLock(
  sessionId: string,
  options?: LockOptions,
): { ok: true } | { ok: false; ownerPid: number } {
  sweepStaleSessionLocks(options);
  mkdirSync(locksDir(options), { recursive: true });
  const lockPath = lockPathForSession(sessionId, options);
  const myPid = process.pid;

  if (existsSync(lockPath)) {
    try {
      const ownerRaw = readFileSync(lockPath, "utf8").trim();
      const ownerPid = Number.parseInt(ownerRaw, 10);
      if (Number.isFinite(ownerPid) && ownerPid !== myPid && isProcessAlive(ownerPid)) return { ok: false, ownerPid };
      unlinkSync(lockPath);
    } catch {
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore best-effort cleanup
      }
    }
  }

  writeFileSync(lockPath, String(myPid), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  return { ok: true };
}

export function sweepStaleSessionLocks(options?: LockOptions): { removed: number; kept: number } {
  const dir = locksDir(options);
  if (!existsSync(dir)) return { removed: 0, kept: 0 };

  let removed = 0;
  let kept = 0;

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".lock")) continue;
    const path = join(dir, entry);
    let ownerPid: number | null = null;
    try {
      const ownerRaw = readFileSync(path, "utf8").trim();
      const parsed = Number.parseInt(ownerRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) ownerPid = parsed;
    } catch {
      // invalid/unreadable lock is treated as stale
    }
    if (ownerPid && isProcessAlive(ownerPid)) {
      kept += 1;
      continue;
    }
    try {
      unlinkSync(path);
      removed += 1;
    } catch {
      // best effort
    }
  }

  return { removed, kept };
}

export function releaseSessionLock(sessionId: string, options?: LockOptions): void {
  const lockPath = lockPathForSession(sessionId, options);
  if (!existsSync(lockPath)) return;
  try {
    const ownerRaw = readFileSync(lockPath, "utf8").trim();
    const ownerPid = Number.parseInt(ownerRaw, 10);
    if (ownerPid === process.pid) unlinkSync(lockPath);
  } catch {
    // best effort
  }
}
