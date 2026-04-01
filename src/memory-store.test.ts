import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryRecord } from "./memory-contract";
import { createSqliteMemoryStore, migrateFromFilesystem, migrateFromMarkdown } from "./memory-store";
import { tempDb, tempDir } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-memory-", createSqliteMemoryStore);
const { createDir, cleanupDirs } = tempDir();
afterEach(() => {
  cleanupStores();
  cleanupDirs();
});

describe("createSqliteMemoryStore", () => {
  test("list returns empty for nonexistent session", async () => {
    const store = createStore();
    const records = await store.list({ scopeKey: "sess_nonexistent" });
    expect(records).toEqual([]);
  });

  test("write + list round-trips a record", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "dst_test001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "project uses Bun, not Node",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 7,
    };
    await store.write(record);
    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test("list returns records sorted chronologically", async () => {
    const store = createStore();
    const older: MemoryRecord = {
      id: "dst_older001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "first observation",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    };
    const newer: MemoryRecord = {
      id: "dst_newer001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "second observation",
      createdAt: "2026-03-04T11:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(newer);
    await store.write(older);
    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records[0]?.content).toBe("first observation");
    expect(records[1]?.content).toBe("second observation");
  });

  test("list isolates sessions", async () => {
    const store = createStore();
    const record1: MemoryRecord = {
      id: "dst_sess1rec",
      scopeKey: "sess_session1",
      kind: "observation",
      content: "session 1 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    const record2: MemoryRecord = {
      id: "dst_sess2rec",
      scopeKey: "sess_session2",
      kind: "observation",
      content: "session 2 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    await store.write(record1);
    await store.write(record2);
    const s1 = await store.list({ scopeKey: "sess_session1" });
    const s2 = await store.list({ scopeKey: "sess_session2" });
    expect(s1).toHaveLength(1);
    expect(s1[0]?.content).toBe("session 1 fact");
    expect(s2).toHaveLength(1);
    expect(s2[0]?.content).toBe("session 2 fact");
  });

  test("remove deletes a record by id", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "dst_rmtest01",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "to be removed",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(record);
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(1);
    await store.remove("dst_rmtest01");
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
  });

  test("remove is a no-op for nonexistent record", async () => {
    const store = createStore();
    await store.remove("dst_missing01");
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
  });

  test("write replaces existing record with same id", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "dst_replace1",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "original",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 1,
    };
    await store.write(record);
    await store.write({ ...record, content: "updated" });
    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("updated");
  });

  test("list filters by kind", async () => {
    const store = createStore();
    await store.write({
      id: "dst_obs001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "an observation",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    });
    await store.write({
      id: "mem_stored01",
      scopeKey: "user_abc123",
      kind: "stored",
      content: "a stored memory",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    });
    const stored = await store.list({ kind: "stored" });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe("mem_stored01");
    const observations = await store.list({ kind: "observation" });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.id).toBe("dst_obs001");
  });

  test("list filters by scope and kind", async () => {
    const store = createStore();
    await store.write({
      id: "mem_user01",
      scopeKey: "user_abc123",
      kind: "stored",
      content: "user memory",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    });
    await store.write({
      id: "dst_user01",
      scopeKey: "user_abc123",
      kind: "observation",
      content: "user observation",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    });
    const stored = await store.list({ scopeKey: "user_abc123", kind: "stored" });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe("mem_user01");
  });

  test("ignores unsafe session ids", async () => {
    const store = createStore();
    const records = await store.list({ scopeKey: "../escape" });
    expect(records).toEqual([]);

    const invalidSessionRecord: MemoryRecord = {
      id: "dst_invalid01",
      scopeKey: "../escape",
      kind: "observation",
      content: "should not be written",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(invalidSessionRecord);
    const stillEmpty = await store.list({ scopeKey: "../escape" });
    expect(stillEmpty).toEqual([]);
  });

  test("supports resource-scoped memory keys", async () => {
    const store = createStore();
    const userRecord: MemoryRecord = {
      id: "dst_user001",
      scopeKey: "user_abc123",
      kind: "observation",
      content: "user fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    };
    const projectRecord: MemoryRecord = {
      id: "dst_proj001",
      scopeKey: "proj_abc123",
      kind: "observation",
      content: "project fact",
      createdAt: "2026-03-04T12:00:01.000Z",
      tokenEstimate: 2,
    };
    await store.write(userRecord);
    await store.write(projectRecord);
    expect((await store.list({ scopeKey: "user_abc123" })).map((record) => record.content)).toEqual(["user fact"]);
    expect((await store.list({ scopeKey: "proj_abc123" })).map((record) => record.content)).toEqual(["project fact"]);
  });
});

describe("embedding storage", () => {
  test("writeEmbedding + getEmbedding round-trips", async () => {
    const store = createStore();
    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    store.writeEmbedding("dst_emb001", "sess_abc123", embedding);
    const result = store.getEmbedding("dst_emb001");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected embedding");
    const arr = new Float32Array(result.buffer, result.byteOffset, result.byteLength / 4);
    expect(arr[0]).toBeCloseTo(0.1);
    expect(arr[1]).toBeCloseTo(0.2);
    expect(arr[2]).toBeCloseTo(0.3);
  });

  test("getEmbedding returns null for missing record", async () => {
    const store = createStore();
    expect(store.getEmbedding("dst_missing")).toBeNull();
  });

  test("removeEmbedding deletes embedding", async () => {
    const store = createStore();
    const embedding = Buffer.from(new Float32Array([1, 2, 3]).buffer);
    store.writeEmbedding("dst_rm001", "sess_abc123", embedding);
    expect(store.getEmbedding("dst_rm001")).not.toBeNull();
    store.removeEmbedding("dst_rm001");
    expect(store.getEmbedding("dst_rm001")).toBeNull();
  });

  test("remove record also removes embedding", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "dst_cascade1",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "test",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 1,
    };
    await store.write(record);
    store.writeEmbedding(record.id, "sess_abc123", Buffer.from(new Float32Array([1]).buffer));
    expect(store.getEmbedding(record.id)).not.toBeNull();
    await store.remove(record.id);
    expect(store.getEmbedding(record.id)).toBeNull();
  });
});

describe("migrateFromFilesystem", () => {
  test("migrates JSON files into SQLite store", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });

    // Legacy format uses "tier" not "kind"
    const legacyRecord = {
      id: "dst_migr001",
      scopeKey: "sess_abc123",
      tier: "observation",
      content: "migrated fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    writeFileSync(join(scopeDir, `${legacyRecord.id}.json`), JSON.stringify(legacyRecord), "utf8");

    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(1);

    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("migrated fact");

    // Old directory should be renamed to distill.bak
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(home, ".acolyte", "distill"))).toBe(false);
    expect(existsSync(join(home, ".acolyte", "distill.bak"))).toBe(true);
  });

  test("returns 0 when no distill directory exists", async () => {
    const home = createDir("acolyte-migrate-");
    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(0);
  });

  test("skips invalid JSON files during migration", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });

    writeFileSync(join(scopeDir, "dst_broken.json"), "not valid json", "utf8");

    // Legacy format uses "tier" not "kind"
    const validRecord = {
      id: "dst_valid001",
      scopeKey: "sess_abc123",
      tier: "observation",
      content: "valid record",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    writeFileSync(join(scopeDir, `${validRecord.id}.json`), JSON.stringify(validRecord), "utf8");

    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(1);

    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("valid record");
  });

  test("renames distill dir even when all files are invalid", async () => {
    const home = createDir("acolyte-migrate-");
    const scopeDir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, "dst_broken.json"), "not valid json", "utf8");

    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromFilesystem(home, store);
    expect(count).toBe(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(home, ".acolyte", "distill"))).toBe(false);
    expect(existsSync(join(home, ".acolyte", "distill.bak"))).toBe(true);
  });
});

describe("migrateFromMarkdown", () => {
  test("migrates markdown memory files into SQLite store", async () => {
    const home = createDir("acolyte-migrate-md-");
    const cwd = createDir("acolyte-migrate-cwd-");
    const userDir = join(home, ".acolyte", "memory", "user");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, "mem_abc123.md"),
      "---\nid: mem_abc123\ncreatedAt: 2026-03-04T12:00:00.000Z\nscope: user\n---\nPrefer concise answers",
      "utf8",
    );

    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromMarkdown(home, cwd, store);
    expect(count).toBe(1);

    const records = await store.list({ kind: "stored" });
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("Prefer concise answers");
    expect(records[0]?.id).toBe("mem_abc123");

    const { existsSync } = await import("node:fs");
    expect(existsSync(userDir)).toBe(false);
    expect(existsSync(`${userDir}.bak`)).toBe(true);
    store.close();
  });

  test("returns 0 when no markdown memory directories exist", async () => {
    const home = createDir("acolyte-migrate-md-");
    const cwd = createDir("acolyte-migrate-cwd-");
    const store = createSqliteMemoryStore(join(home, "test.db"));
    const count = await migrateFromMarkdown(home, cwd, store);
    expect(count).toBe(0);
    store.close();
  });
});
