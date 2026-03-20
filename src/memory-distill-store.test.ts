import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DistillRecord } from "./memory-contract";
import { createSqliteDistillStore, migrateFromFilesystem } from "./memory-distill-store";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

function createStore(dir: string) {
  return createSqliteDistillStore(join(dir, "test.db"));
}

describe("createSqliteDistillStore", () => {
  test("list returns empty for nonexistent session", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const records = await store.list("sess_nonexistent");
    expect(records).toEqual([]);
  });

  test("write + list round-trips a record", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const record: DistillRecord = {
      id: "dst_test001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "project uses Bun, not Node",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 7,
    };
    await store.write(record);
    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test("list returns records sorted chronologically", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const older: DistillRecord = {
      id: "dst_older001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "first observation",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    };
    const newer: DistillRecord = {
      id: "dst_newer001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "second observation",
      createdAt: "2026-03-04T11:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(newer);
    await store.write(older);
    const records = await store.list("sess_abc123");
    expect(records[0]?.content).toBe("first observation");
    expect(records[1]?.content).toBe("second observation");
  });

  test("list isolates sessions", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const record1: DistillRecord = {
      id: "dst_sess1rec",
      sessionId: "sess_session1",
      tier: "observation",
      content: "session 1 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    const record2: DistillRecord = {
      id: "dst_sess2rec",
      sessionId: "sess_session2",
      tier: "observation",
      content: "session 2 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    await store.write(record1);
    await store.write(record2);
    const s1 = await store.list("sess_session1");
    const s2 = await store.list("sess_session2");
    expect(s1).toHaveLength(1);
    expect(s1[0]?.content).toBe("session 1 fact");
    expect(s2).toHaveLength(1);
    expect(s2[0]?.content).toBe("session 2 fact");
  });

  test("remove deletes a record by id and scope key", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const record: DistillRecord = {
      id: "dst_rmtest01",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "to be removed",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(record);
    expect(await store.list("sess_abc123")).toHaveLength(1);
    await store.remove("dst_rmtest01", "sess_abc123");
    expect(await store.list("sess_abc123")).toHaveLength(0);
  });

  test("remove is a no-op for nonexistent record", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    await store.remove("dst_missing01", "sess_abc123");
    expect(await store.list("sess_abc123")).toHaveLength(0);
  });

  test("write replaces existing record with same id", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const record: DistillRecord = {
      id: "dst_replace1",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "original",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 1,
    };
    await store.write(record);
    await store.write({ ...record, content: "updated" });
    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("updated");
  });

  test("ignores unsafe session ids", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const records = await store.list("../escape");
    expect(records).toEqual([]);

    const invalidSessionRecord: DistillRecord = {
      id: "dst_invalid01",
      sessionId: "../escape",
      tier: "observation",
      content: "should not be written",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(invalidSessionRecord);
    const stillEmpty = await store.list("../escape");
    expect(stillEmpty).toEqual([]);
  });

  test("supports resource-scoped distill keys", async () => {
    const dir = createDir("acolyte-distill-");
    const store = createStore(dir);
    const userRecord: DistillRecord = {
      id: "dst_user001",
      sessionId: "user_abc123",
      tier: "observation",
      content: "user fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    };
    const projectRecord: DistillRecord = {
      id: "dst_proj001",
      sessionId: "proj_abc123",
      tier: "observation",
      content: "project fact",
      createdAt: "2026-03-04T12:00:01.000Z",
      tokenEstimate: 2,
    };
    await store.write(userRecord);
    await store.write(projectRecord);
    expect((await store.list("user_abc123")).map((record) => record.content)).toEqual(["user fact"]);
    expect((await store.list("proj_abc123")).map((record) => record.content)).toEqual(["project fact"]);
  });
});

describe("migrateFromFilesystem", () => {
  test("migrates JSON files into SQLite store", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });

    const record: DistillRecord = {
      id: "dst_migr001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "migrated fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    writeFileSync(join(scopeDir, `${record.id}.json`), JSON.stringify(record), "utf8");

    const store = createSqliteDistillStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(1);

    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("migrated fact");

    // Old directory should be renamed to distill.bak
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(home, ".acolyte", "distill"))).toBe(false);
    expect(existsSync(join(home, ".acolyte", "distill.bak"))).toBe(true);
  });

  test("returns 0 when no distill directory exists", async () => {
    const home = createDir("acolyte-migrate-");
    const store = createSqliteDistillStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(0);
  });

  test("skips invalid JSON files during migration", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });

    writeFileSync(join(scopeDir, "dst_broken.json"), "not valid json", "utf8");

    const validRecord: DistillRecord = {
      id: "dst_valid001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "valid record",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    writeFileSync(join(scopeDir, `${validRecord.id}.json`), JSON.stringify(validRecord), "utf8");

    const store = createSqliteDistillStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(1);

    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("valid record");
  });

  test("renames distill dir even when all files are invalid", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, "dst_broken.json"), "not valid json", "utf8");

    const store = createSqliteDistillStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(home, ".acolyte", "distill"))).toBe(false);
    expect(existsSync(join(home, ".acolyte", "distill.bak"))).toBe(true);
  });
});
