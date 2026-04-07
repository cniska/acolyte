import { afterEach, describe, expect, test } from "bun:test";
import type { MemoryRecord, MemoryStore } from "./memory-contract";

export function memoryStoreContractTests(
  name: string,
  setup: { create: () => MemoryStore | Promise<MemoryStore>; cleanup: () => void | Promise<void> },
) {
  let store: MemoryStore;

  afterEach(async () => {
    await setup.cleanup();
  });

  async function getStore(): Promise<MemoryStore> {
    store = await setup.create();
    return store;
  }

  describe(`${name} MemoryStore contract`, () => {
    test("list returns empty for nonexistent session", async () => {
      const s = await getStore();
      const records = await s.list({ scopeKey: "sess_nonexistent" });
      expect(records).toEqual([]);
    });

    test("write + list round-trips a record", async () => {
      const s = await getStore();
      const record: MemoryRecord = {
        id: "mem_test001",
        scopeKey: "sess_abc123",
        kind: "observation",
        content: "project uses Bun, not Node",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 7,
      };
      await s.write(record);
      const records = await s.list({ scopeKey: "sess_abc123" });
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ ...record, lastRecalledAt: null });
    });

    test("list returns records sorted chronologically", async () => {
      const s = await getStore();
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
      await s.write(newer);
      await s.write(older);
      const records = await s.list({ scopeKey: "sess_abc123" });
      expect(records[0]?.content).toBe("first observation");
      expect(records[1]?.content).toBe("second observation");
    });

    test("list isolates sessions", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_sess1rec",
        scopeKey: "sess_session1",
        kind: "observation",
        content: "session 1 fact",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 4,
      });
      await s.write({
        id: "mem_sess2rec",
        scopeKey: "sess_session2",
        kind: "observation",
        content: "session 2 fact",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 4,
      });
      const s1 = await s.list({ scopeKey: "sess_session1" });
      const s2 = await s.list({ scopeKey: "sess_session2" });
      expect(s1).toHaveLength(1);
      expect(s1[0]?.content).toBe("session 1 fact");
      expect(s2).toHaveLength(1);
      expect(s2[0]?.content).toBe("session 2 fact");
    });

    test("remove deletes a record by id", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_rmtest01",
        scopeKey: "sess_abc123",
        kind: "observation",
        content: "to be removed",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 3,
      });
      expect(await s.list({ scopeKey: "sess_abc123" })).toHaveLength(1);
      await s.remove("mem_rmtest01");
      expect(await s.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
    });

    test("remove is a no-op for nonexistent record", async () => {
      const s = await getStore();
      await s.remove("mem_missing01");
      expect(await s.list({ scopeKey: "sess_abc123" })).toHaveLength(0);
    });

    test("write replaces existing record with same id", async () => {
      const s = await getStore();
      const record: MemoryRecord = {
        id: "mem_replace1",
        scopeKey: "sess_abc123",
        kind: "observation",
        content: "original",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 1,
      };
      await s.write(record);
      await s.write({ ...record, content: "updated" });
      const records = await s.list({ scopeKey: "sess_abc123" });
      expect(records).toHaveLength(1);
      expect(records[0]?.content).toBe("updated");
    });

    test("list filters by kind", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_obs001",
        scopeKey: "sess_abc123",
        kind: "observation",
        content: "an observation",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_stored01",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "a stored memory",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 3,
      });
      const stored = await s.list({ kind: "stored" });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("mem_stored01");
      const observations = await s.list({ kind: "observation" });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.id).toBe("mem_obs001");
    });

    test("list filters by scope and kind", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_user01",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "user memory",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_user02",
        scopeKey: "user_abc123",
        kind: "observation",
        content: "user observation",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      const stored = await s.list({ scopeKey: "user_abc123", kind: "stored" });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("mem_user01");
    });

    test("ignores unsafe session ids", async () => {
      const s = await getStore();
      const records = await s.list({ scopeKey: "../escape" });
      expect(records).toEqual([]);

      await s.write({
        id: "mem_invalid01",
        scopeKey: "../escape",
        kind: "observation",
        content: "should not be written",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 3,
      });
      const stillEmpty = await s.list({ scopeKey: "../escape" });
      expect(stillEmpty).toEqual([]);
    });

    test("supports resource-scoped memory keys", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_user001",
        scopeKey: "user_abc123",
        kind: "observation",
        content: "user fact",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_proj001",
        scopeKey: "proj_abc123",
        kind: "observation",
        content: "project fact",
        createdAt: "2026-03-04T12:00:01.000Z",
        tokenEstimate: 2,
      });
      expect((await s.list({ scopeKey: "user_abc123" })).map((r) => r.content)).toEqual(["user fact"]);
      expect((await s.list({ scopeKey: "proj_abc123" })).map((r) => r.content)).toEqual(["project fact"]);
    });
  });

  describe(`${name} touchRecalled`, () => {
    test("sets last_recalled_at on specified records", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_touch001",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "recall me",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      const before = await s.list({ scopeKey: "user_abc123" });
      expect(before[0]?.lastRecalledAt).toBeNull();

      await s.touchRecalled(["mem_touch001"]);
      const after = await s.list({ scopeKey: "user_abc123" });
      expect(after[0]?.lastRecalledAt).not.toBeNull();
    });

    test("does not touch records not in the id list", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_touched1",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "will be touched",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_untouchd",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "will not be touched",
        createdAt: "2026-03-04T12:00:01.000Z",
        tokenEstimate: 3,
      });
      await s.touchRecalled(["mem_touched1"]);
      const records = await s.list({ scopeKey: "user_abc123" });
      const touched = records.find((r) => r.id === "mem_touched1");
      const untouched = records.find((r) => r.id === "mem_untouchd");
      expect(touched?.lastRecalledAt).not.toBeNull();
      expect(untouched?.lastRecalledAt).toBeNull();
    });

    test("no-ops on empty id list", async () => {
      const s = await getStore();
      await expect(s.touchRecalled([])).resolves.toBeUndefined();
    });
  });

  describe(`${name} embedding storage`, () => {
    test("writeEmbedding + getEmbedding round-trips", async () => {
      const s = await getStore();
      const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
      await s.writeEmbedding("mem_emb001", "sess_abc123", embedding);
      const result = await s.getEmbedding("mem_emb001");
      expect(result).not.toBeNull();
      if (!result) throw new Error("expected embedding");
      const arr = new Float32Array(result.buffer, result.byteOffset, result.byteLength / 4);
      expect(arr[0]).toBeCloseTo(0.1);
      expect(arr[1]).toBeCloseTo(0.2);
      expect(arr[2]).toBeCloseTo(0.3);
    });

    test("getEmbedding returns null for missing record", async () => {
      const s = await getStore();
      expect(await s.getEmbedding("mem_missing")).toBeNull();
    });

    test("removeEmbedding deletes embedding", async () => {
      const s = await getStore();
      const embedding = Buffer.from(new Float32Array([1, 2, 3]).buffer);
      await s.writeEmbedding("mem_rm001", "sess_abc123", embedding);
      expect(await s.getEmbedding("mem_rm001")).not.toBeNull();
      await s.removeEmbedding("mem_rm001");
      expect(await s.getEmbedding("mem_rm001")).toBeNull();
    });

    test("remove record also removes embedding", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_cascade1",
        scopeKey: "sess_abc123",
        kind: "observation",
        content: "test",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 1,
      });
      await s.writeEmbedding("mem_cascade1", "sess_abc123", Buffer.from(new Float32Array([1]).buffer));
      expect(await s.getEmbedding("mem_cascade1")).not.toBeNull();
      await s.remove("mem_cascade1");
      expect(await s.getEmbedding("mem_cascade1")).toBeNull();
    });
  });
}
