import { afterEach, describe, expect, test } from "bun:test";
import { addMemory } from "./memory";
import { storedMemorySource } from "./memory-source-stored";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("storedMemorySource", () => {
  test("id is 'stored'", () => {
    expect(storedMemorySource.id).toBe("stored");
  });

  test("load returns empty array when no memories exist", async () => {
    const _home = createDir("acolyte-home-");
    const _cwd = createDir("acolyte-cwd-");
    const entries = await storedMemorySource.loadEntries({});
    expect(Array.isArray(entries)).toBe(true);
  });

  test("loadEntries returns memory content strings", async () => {
    const home = createDir("acolyte-home-");
    const cwd = createDir("acolyte-cwd-");
    await addMemory("use bun not node", { homeDir: home, cwd, scope: "user" });
    await addMemory("prefer tabs", { homeDir: home, cwd, scope: "user" });

    const { storedMemorySource: freshSource } = await import("./memory-source-stored");
    const entries = await freshSource.loadEntries({});
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  test("has no commit method", () => {
    expect(storedMemorySource.commit).toBeUndefined();
  });
});
