import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths";
import { acquireLock, releaseLock, sweepStaleLocks } from "./resource-lock";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
const createTempHome = () => createDir("acolyte-lock-test-");
afterEach(cleanupDirs);

describe("resource lock", () => {
  test("allows re-acquire by same process", () => {
    const env = { HOME: createTempHome() };
    const first = acquireLock("sess_test", { env });
    const second = acquireLock("sess_test", { env });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    releaseLock("sess_test", { env });
  });

  test("reclaims stale lock from non-running pid", () => {
    const homeDir = createTempHome();
    const env = { HOME: homeDir };
    const locksDir = join(stateDir(env), "locks");
    mkdirSync(locksDir, { recursive: true });
    const lockPath = join(stateDir(env), "locks", "sess_test.lock");
    writeFileSync(lockPath, "999999");
    const result = acquireLock("sess_test", { env });
    expect(result.ok).toBe(true);
    releaseLock("sess_test", { env });
  });

  test("blocks when lock is owned by a live different pid", () => {
    const homeDir = createTempHome();
    const env = { HOME: homeDir };
    const sleeper = Bun.spawn(["sleep", "2"], { stdout: "ignore", stderr: "ignore" });
    try {
      const locksDir = join(stateDir(env), "locks");
      mkdirSync(locksDir, { recursive: true });
      const lockPath = join(stateDir(env), "locks", "sess_test.lock");
      writeFileSync(lockPath, String(sleeper.pid));
      const result = acquireLock("sess_test", { env });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.ownerPid).toBe(sleeper.pid);
    } finally {
      sleeper.kill();
      releaseLock("sess_test", { env });
    }
  });

  test("sweepStaleLocks removes dead and malformed locks, keeps live locks", () => {
    const homeDir = createTempHome();
    const env = { HOME: homeDir };
    const locksDir = join(stateDir(env), "locks");
    mkdirSync(locksDir, { recursive: true });

    const stalePath = join(locksDir, "sess_stale.lock");
    const malformedPath = join(locksDir, "sess_bad.lock");
    writeFileSync(stalePath, "999999");
    writeFileSync(malformedPath, "not-a-pid");

    const sleeper = Bun.spawn(["sleep", "2"], { stdout: "ignore", stderr: "ignore" });
    const livePath = join(locksDir, "sess_live.lock");
    writeFileSync(livePath, String(sleeper.pid));

    try {
      const summary = sweepStaleLocks({ env });
      expect(summary.removed).toBe(2);
      expect(summary.kept).toBe(1);
      expect(existsSync(livePath)).toBe(true);
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(malformedPath)).toBe(false);
    } finally {
      sleeper.kill();
      try {
        releaseLock("sess_live", { env });
      } catch {
        // best effort
      }
    }
  });
});
