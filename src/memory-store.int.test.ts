import { afterEach, describe, expect, test } from "bun:test";
import type { MemoryRecord } from "./memory-contract";
import { createSqliteMemoryStore } from "./memory-store";
import { tempDb } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-memory-", createSqliteMemoryStore);
afterEach(cleanupStores);

describe("createSqliteMemoryStore", () => {
  test("list returns empty for nonexistent session", async () => {
    const store = createStore();
    const records = await store.list({ scopeKey: "sess_nonexistent" });
    expect(records).toEqual([]);
  });

  test("write + list round-trips a record", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "mem_test001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "project uses Bun, not Node",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 7,
    };
    await store.write(record);
    const records = await store.list({ scopeKey: "sess_abc123" });
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ ...record, lastRecalledAt: null });
  });

  test("list returns records sorted chronologically", async () => {
    const store = createStore();
    const older: MemoryRecord = {
      id: "mem_older001",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "first observation",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    };
    const newer: MemoryRecord = {
      id: "mem_newer001",
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
      id: "mem_sess1rec",
      scopeKey: "sess_session1",
      kind: "observation",
      content: "session 1 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    const record2: MemoryRecord = {
      id: "mem_sess2rec",
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
      id: "mem_rmtest01",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "to be removed",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(record);
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(1);
    await store.remove("mem_rmtest01");
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
  });

  test("remove is a no-op for nonexistent record", async () => {
    const store = createStore();
    await store.remove("mem_missing01");
    expect(await store.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
  });

  test("write replaces existing record with same id", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "mem_replace1",
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
      id: "mem_obs001",
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
    expect(observations[0]?.id).toBe("mem_obs001");
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
      id: "mem_user02",
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
      id: "mem_invalid01",
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
      id: "mem_user001",
      scopeKey: "user_abc123",
      kind: "observation",
      content: "user fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    };
    const projectRecord: MemoryRecord = {
      id: "mem_proj001",
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

describe("touchRecalled", () => {
  test("sets last_recalled_at on specified records", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "mem_touch001",
      scopeKey: "user_abc123",
      kind: "stored",
      content: "recall me",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    };
    await store.write(record);
    const before = await store.list({ scopeKey: "user_abc123" });
    expect(before[0]?.lastRecalledAt).toBeNull();

    await store.touchRecalled(["mem_touch001"]);
    const after = await store.list({ scopeKey: "user_abc123" });
    expect(after[0]?.lastRecalledAt).not.toBeNull();
  });

  test("does not touch records not in the id list", async () => {
    const store = createStore();
    await store.write({
      id: "mem_touched1",
      scopeKey: "user_abc123",
      kind: "stored",
      content: "will be touched",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    });
    await store.write({
      id: "mem_untouchd",
      scopeKey: "user_abc123",
      kind: "stored",
      content: "will not be touched",
      createdAt: "2026-03-04T12:00:01.000Z",
      tokenEstimate: 3,
    });
    await store.touchRecalled(["mem_touched1"]);
    const records = await store.list({ scopeKey: "user_abc123" });
    const touched = records.find((r) => r.id === "mem_touched1");
    const untouched = records.find((r) => r.id === "mem_untouchd");
    expect(touched?.lastRecalledAt).not.toBeNull();
    expect(untouched?.lastRecalledAt).toBeNull();
  });

  test("no-ops on empty id list", async () => {
    const store = createStore();
    await expect(store.touchRecalled([])).resolves.toBeUndefined();
  });
});

describe("embedding storage", () => {
  test("writeEmbedding + getEmbedding round-trips", async () => {
    const store = createStore();
    const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    await store.writeEmbedding("mem_emb001", "sess_abc123", embedding);
    const result = await store.getEmbedding("mem_emb001");
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected embedding");
    const arr = new Float32Array(result.buffer, result.byteOffset, result.byteLength / 4);
    expect(arr[0]).toBeCloseTo(0.1);
    expect(arr[1]).toBeCloseTo(0.2);
    expect(arr[2]).toBeCloseTo(0.3);
  });

  test("getEmbedding returns null for missing record", async () => {
    const store = createStore();
    expect(await store.getEmbedding("mem_missing")).toBeNull();
  });

  test("removeEmbedding deletes embedding", async () => {
    const store = createStore();
    const embedding = Buffer.from(new Float32Array([1, 2, 3]).buffer);
    await store.writeEmbedding("mem_rm001", "sess_abc123", embedding);
    expect(await store.getEmbedding("mem_rm001")).not.toBeNull();
    await store.removeEmbedding("mem_rm001");
    expect(await store.getEmbedding("mem_rm001")).toBeNull();
  });

  test("remove record also removes embedding", async () => {
    const store = createStore();
    const record: MemoryRecord = {
      id: "mem_cascade1",
      scopeKey: "sess_abc123",
      kind: "observation",
      content: "test",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 1,
    };
    await store.write(record);
    await store.writeEmbedding(record.id, "sess_abc123", Buffer.from(new Float32Array([1]).buffer));
    expect(await store.getEmbedding(record.id)).not.toBeNull();
    await store.remove(record.id);
    expect(await store.getEmbedding(record.id)).toBeNull();
  });
});
