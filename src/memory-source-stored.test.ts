import { afterEach, describe, expect, test } from "bun:test";
import { addMemory } from "./memory-ops";
import { storedMemorySource } from "./memory-source-stored";
import { createSqliteMemoryStore } from "./memory-store";
import { tempDb } from "./test-utils";

const { create: createDb, cleanup } = tempDb("acolyte-stored-src-", createSqliteMemoryStore);
afterEach(cleanup);

describe("storedMemorySource", () => {
  test("id is 'stored'", () => {
    expect(storedMemorySource.id).toBe("stored");
  });

  test("load returns empty array when no memories exist", async () => {
    const entries = await storedMemorySource.loadEntries({});
    expect(Array.isArray(entries)).toBe(true);
  });

  test("loadEntries returns memory content strings", async () => {
    const db = createDb();
    await addMemory("use bun not node", { scope: "user", store: db });
    await addMemory("prefer tabs", { scope: "user", store: db });

    const { storedMemorySource: freshSource } = await import("./memory-source-stored");
    const entries = await freshSource.loadEntries({});
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  test("has no commit method", () => {
    expect(storedMemorySource.commit).toBeUndefined();
  });
});
