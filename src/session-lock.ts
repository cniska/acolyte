import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  return join(options?.homeDir ?? homedir(), ".acolyte", "locks");
}

function lockPathForSession(sessionId: string, options?: LockOptions): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(locksDir(options), `${safe}.lock`);
}

export function acquireSessionLock(
  sessionId: string,
  options?: LockOptions,
): { ok: true } | { ok: false; ownerPid: number } {
  mkdirSync(locksDir(options), { recursive: true });
  const lockPath = lockPathForSession(sessionId, options);
  const myPid = process.pid;

  if (existsSync(lockPath)) {
    try {
      const ownerRaw = readFileSync(lockPath, "utf8").trim();
      const ownerPid = Number.parseInt(ownerRaw, 10);
      if (Number.isFinite(ownerPid) && ownerPid !== myPid && isProcessAlive(ownerPid)) {
        return { ok: false, ownerPid };
      }
      unlinkSync(lockPath);
    } catch {
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore best-effort cleanup
      }
    }
  }

  writeFileSync(lockPath, String(myPid), { encoding: "utf8", mode: 0o644 });
  return { ok: true };
}

export function releaseSessionLock(sessionId: string, options?: LockOptions): void {
  const lockPath = lockPathForSession(sessionId, options);
  if (!existsSync(lockPath)) {
    return;
  }
  try {
    const ownerRaw = readFileSync(lockPath, "utf8").trim();
    const ownerPid = Number.parseInt(ownerRaw, 10);
    if (ownerPid === process.pid) {
      unlinkSync(lockPath);
    }
  } catch {
    // best effort
  }
}
