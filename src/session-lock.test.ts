import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";

const tempDirs: string[] = [];

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "acolyte-lock-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("session lock", () => {
  test("allows re-acquire by same process", () => {
    const homeDir = createTempHome();
    const first = acquireSessionLock("sess_test", { homeDir });
    const second = acquireSessionLock("sess_test", { homeDir });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    releaseSessionLock("sess_test", { homeDir });
  });

  test("reclaims stale lock from non-running pid", () => {
    const homeDir = createTempHome();
    const locksDir = join(homeDir, ".acolyte", "locks");
    mkdirSync(locksDir, { recursive: true });
    const lockPath = join(homeDir, ".acolyte", "locks", "sess_test.lock");
    writeFileSync(lockPath, "999999");
    const result = acquireSessionLock("sess_test", { homeDir });
    expect(result.ok).toBe(true);
    releaseSessionLock("sess_test", { homeDir });
  });

  test("blocks when lock is owned by a live different pid", () => {
    const homeDir = createTempHome();
    const sleeper = Bun.spawn(["sleep", "2"], { stdout: "ignore", stderr: "ignore" });
    try {
      const locksDir = join(homeDir, ".acolyte", "locks");
      mkdirSync(locksDir, { recursive: true });
      const lockPath = join(homeDir, ".acolyte", "locks", "sess_test.lock");
      writeFileSync(lockPath, String(sleeper.pid));
      const result = acquireSessionLock("sess_test", { homeDir });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.ownerPid).toBe(sleeper.pid);
      }
    } finally {
      sleeper.kill();
      releaseSessionLock("sess_test", { homeDir });
    }
  });
});
