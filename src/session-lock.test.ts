import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireSessionLock, releaseSessionLock, sweepStaleSessionLocks } from "./session-lock";
import { tempDir } from "./test-factory";

const { createDir, cleanupDirs } = tempDir();
const createTempHome = () => createDir("acolyte-lock-test-");
afterEach(cleanupDirs);

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
      if (!result.ok) expect(result.ownerPid).toBe(sleeper.pid);
    } finally {
      sleeper.kill();
      releaseSessionLock("sess_test", { homeDir });
    }
  });

  test("sweepStaleSessionLocks removes dead and malformed locks, keeps live locks", () => {
    const homeDir = createTempHome();
    const locksDir = join(homeDir, ".acolyte", "locks");
    mkdirSync(locksDir, { recursive: true });

    const stalePath = join(locksDir, "sess_stale.lock");
    const malformedPath = join(locksDir, "sess_bad.lock");
    writeFileSync(stalePath, "999999");
    writeFileSync(malformedPath, "not-a-pid");

    const sleeper = Bun.spawn(["sleep", "2"], { stdout: "ignore", stderr: "ignore" });
    const livePath = join(locksDir, "sess_live.lock");
    writeFileSync(livePath, String(sleeper.pid));

    try {
      const summary = sweepStaleSessionLocks({ homeDir });
      expect(summary.removed).toBe(2);
      expect(summary.kept).toBe(1);
      expect(existsSync(livePath)).toBe(true);
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(malformedPath)).toBe(false);
    } finally {
      sleeper.kill();
      try {
        releaseSessionLock("sess_live", { homeDir });
      } catch {
        // best effort
      }
    }
  });
});
