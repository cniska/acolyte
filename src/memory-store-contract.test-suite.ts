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
        content: "project uses Bun, not Node",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 7,
      };
      await s.write(record);
      const records = await s.list({ scopeKey: "sess_abc123" });
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ ...record, lastRecalledAt: null, topic: null });
    });

    test("list returns records sorted chronologically", async () => {
      const s = await getStore();
      const older: MemoryRecord = {
        id: "mem_older001",
        scopeKey: "sess_abc123",
        content: "first observation",
        createdAt: "2026-03-04T10:00:00.000Z",
        tokenEstimate: 3,
      };
      const newer: MemoryRecord = {
        id: "mem_newer001",
        scopeKey: "sess_abc123",
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
        content: "session 1 fact",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 4,
      });
      await s.write({
        id: "mem_sess2rec",
        scopeKey: "sess_session2",
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

    test("ignores unsafe session ids", async () => {
      const s = await getStore();
      const records = await s.list({ scopeKey: "../escape" });
      expect(records).toEqual([]);

      await s.write({
        id: "mem_invalid01",
        scopeKey: "../escape",
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
        content: "user fact",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_proj001",
        scopeKey: "proj_abc123",
        content: "project fact",
        createdAt: "2026-03-04T12:00:01.000Z",
        tokenEstimate: 2,
      });
      expect((await s.list({ scopeKey: "user_abc123" })).map((r) => r.content)).toEqual(["user fact"]);
      expect((await s.list({ scopeKey: "proj_abc123" })).map((r) => r.content)).toEqual(["project fact"]);
    });
  });

  describe(`${name} retirement`, () => {
    async function seed(s: MemoryStore, id: string, content = "a fact"): Promise<void> {
      await s.write({
        id,
        scopeKey: "proj_abc123",
        content,
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
    }

    test("retire moves a record out of the active set and into the archive", async () => {
      const s = await getStore();
      await seed(s, "mem_retire001");
      await s.retire(["mem_retire001"], { kind: "noise" });

      expect(await s.list({ scopeKey: "proj_abc123" })).toHaveLength(0);
      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived).toHaveLength(1);
      expect(archived[0]?.id).toBe("mem_retire001");
      expect(archived[0]?.disposition).toEqual({ kind: "noise" });
      expect(archived[0]?.retiredAt).toBeTruthy();
    });

    test("retire preserves the record's own fields", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_retire002",
        scopeKey: "proj_abc123",
        content: "explicit memory",
        createdAt: "2026-03-04T09:30:00.000Z",
        tokenEstimate: 5,
        topic: "tooling",
      });
      await s.retire(["mem_retire002"], { kind: "capacity" });
      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived[0]).toMatchObject({
        id: "mem_retire002",
        scopeKey: "proj_abc123",
        content: "explicit memory",
        createdAt: "2026-03-04T09:30:00.000Z",
        tokenEstimate: 5,
        topic: "tooling",
        disposition: { kind: "capacity" },
      });
    });

    test("retire drops the embedding", async () => {
      const s = await getStore();
      await seed(s, "mem_retire003");
      await s.writeEmbedding("mem_retire003", "proj_abc123", Buffer.from(new Float32Array([1, 0]).buffer));
      expect(await s.getEmbedding("mem_retire003")).not.toBeNull();
      await s.retire(["mem_retire003"], { kind: "noise" });
      expect(await s.getEmbedding("mem_retire003")).toBeNull();
    });

    test("a superseded disposition keeps its successor lineage", async () => {
      const s = await getStore();
      await seed(s, "mem_merged001", "first half");
      await seed(s, "mem_merged002", "second half");
      await seed(s, "mem_success001", "the merged fact");
      await s.retire(["mem_merged001", "mem_merged002"], { kind: "superseded", by: ["mem_success001"] });

      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived).toHaveLength(2);
      for (const record of archived) {
        expect(record.disposition).toEqual({ kind: "superseded", by: ["mem_success001"] });
      }
      const active = await s.list({ scopeKey: "proj_abc123" });
      expect(active.map((r) => r.id)).toEqual(["mem_success001"]);
    });

    test("a split keeps every successor in the lineage", async () => {
      const s = await getStore();
      await seed(s, "mem_compound1", "two claims joined by and");
      await s.retire(["mem_compound1"], { kind: "superseded", by: ["mem_atomic001", "mem_atomic002"] });
      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived[0]?.disposition).toEqual({
        kind: "superseded",
        by: ["mem_atomic001", "mem_atomic002"],
      });
    });

    test("listArchive filters by disposition", async () => {
      const s = await getStore();
      await seed(s, "mem_noise0001");
      await seed(s, "mem_capacity01");
      await s.retire(["mem_noise0001"], { kind: "noise" });
      await s.retire(["mem_capacity01"], { kind: "capacity" });

      const noise = await s.listArchive({ scopeKey: "proj_abc123", disposition: "noise" });
      expect(noise.map((r) => r.id)).toEqual(["mem_noise0001"]);
      const capacity = await s.listArchive({ scopeKey: "proj_abc123", disposition: "capacity" });
      expect(capacity.map((r) => r.id)).toEqual(["mem_capacity01"]);
    });

    test("listArchive filters by kind and isolates scopes", async () => {
      const s = await getStore();
      await seed(s, "mem_arch0obs1");
      await s.write({
        id: "mem_arch0oth1",
        scopeKey: "user_abc123",
        content: "other scope",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.retire(["mem_arch0obs1", "mem_arch0oth1"], { kind: "noise" });

      expect((await s.listArchive({ scopeKey: "proj_abc123" })).map((r) => r.id)).toEqual(["mem_arch0obs1"]);
      expect((await s.listArchive({ scopeKey: "user_abc123" })).map((r) => r.id)).toEqual(["mem_arch0oth1"]);
    });

    test("restore returns a record to the active set and empties it from the archive", async () => {
      const s = await getStore();
      await seed(s, "mem_restore001", "worth keeping after all");
      await s.retire(["mem_restore001"], { kind: "noise" });
      const restored = await s.restore(["mem_restore001"]);

      expect(restored.map((r) => r.id)).toEqual(["mem_restore001"]);
      expect(restored[0]?.content).toBe("worth keeping after all");
      const active = await s.list({ scopeKey: "proj_abc123" });
      expect(active).toHaveLength(1);
      expect(active[0]?.content).toBe("worth keeping after all");
      expect(await s.listArchive({ scopeKey: "proj_abc123" })).toHaveLength(0);
    });

    test("restore round-trips a split's original record", async () => {
      const s = await getStore();
      await seed(s, "mem_split00001", "the original compound");
      await s.retire(["mem_split00001"], { kind: "superseded", by: ["mem_part000001", "mem_part000002"] });
      await s.restore(["mem_split00001"]);
      const active = await s.list({ scopeKey: "proj_abc123" });
      expect(active.map((r) => r.content)).toEqual(["the original compound"]);
    });

    test("retire and restore no-op on empty id lists", async () => {
      const s = await getStore();
      expect(await s.retire([], { kind: "noise" })).toEqual([]);
      expect(await s.restore([])).toEqual([]);
    });

    test("retire ignores unknown ids and restore returns nothing for them", async () => {
      const s = await getStore();
      expect(await s.retire(["mem_unknown001"], { kind: "noise" })).toEqual([]);
      expect(await s.listArchive()).toHaveLength(0);
      expect(await s.restore(["mem_unknown001"])).toEqual([]);
    });

    test("retire reports only the ids it actually moved", async () => {
      const s = await getStore();
      await seed(s, "mem_present001");
      const retired = await s.retire(["mem_present001", "mem_absent0001"], { kind: "noise" });
      expect(retired).toEqual(["mem_present001"]);
      expect((await s.listArchive()).map((r) => r.id)).toEqual(["mem_present001"]);
    });

    test("a full retire and restore cycle preserves every field", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_fidelity01",
        scopeKey: "proj_abc123",
        content: "the fact with every field set",
        createdAt: "2026-03-04T08:15:00.000Z",
        tokenEstimate: 9,
        topic: "lifecycle",
      });
      await s.touchRecalled(["mem_fidelity01"]);
      const before = (await s.list({ scopeKey: "proj_abc123" }))[0];
      expect(before?.lastRecalledAt).not.toBeNull();

      await s.retire(["mem_fidelity01"], { kind: "capacity" });
      await s.restore(["mem_fidelity01"]);

      const after = (await s.list({ scopeKey: "proj_abc123" }))[0];
      expect(after).toEqual(before);
    });

    test("retiring again after a restore records the new disposition", async () => {
      const s = await getStore();
      await seed(s, "mem_recycled01");
      await s.retire(["mem_recycled01"], { kind: "superseded", by: ["mem_successor1"] });
      await s.restore(["mem_recycled01"]);
      await s.retire(["mem_recycled01"], { kind: "noise" });

      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived).toHaveLength(1);
      expect(archived[0]?.disposition).toEqual({ kind: "noise" });
    });

    test("the archive orders records by when they were retired", async () => {
      const s = await getStore();
      await seed(s, "mem_first00001");
      await s.retire(["mem_first00001"], { kind: "noise" });
      await seed(s, "mem_second0001");
      await s.retire(["mem_second0001"], { kind: "noise" });

      const archived = await s.listArchive({ scopeKey: "proj_abc123" });
      expect(archived.map((r) => r.id)).toEqual(["mem_first00001", "mem_second0001"]);
      const [first, second] = archived;
      expect(first && second && first.retiredAt <= second.retiredAt).toBe(true);
      expect(first && Number.isFinite(Date.parse(first.retiredAt))).toBe(true);
    });

    test("a retired record is invisible to list", async () => {
      const s = await getStore();
      await seed(s, "mem_hidden0001");
      await s.retire(["mem_hidden0001"], { kind: "noise" });
      expect(await s.list()).toHaveLength(0);
    });
  });

  describe(`${name} touchRecalled`, () => {
    test("sets last_recalled_at on specified records", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_touch001",
        scopeKey: "user_abc123",
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
        content: "will be touched",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await s.write({
        id: "mem_untouchd",
        scopeKey: "user_abc123",
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

    test("getEmbedding returns bytes that base64-encode as themselves", async () => {
      const s = await getStore();
      const embedding = Buffer.from(new Float32Array([0.1, -0.2, 0.3]).buffer);
      await s.writeEmbedding("mem_emb64a", "sess_abc123", embedding);
      const result = await s.getEmbedding("mem_emb64a");
      if (!result) throw new Error("expected embedding");
      expect(result.toString("base64")).toBe(embedding.toString("base64"));
    });

    test("getEmbeddings returns bytes that base64-encode as themselves", async () => {
      const s = await getStore();
      const embedding = Buffer.from(new Float32Array([0.4, -0.5, 0.6]).buffer);
      await s.writeEmbedding("mem_emb64b", "sess_abc123", embedding);
      const result = (await s.getEmbeddings(["mem_emb64b"])).get("mem_emb64b");
      if (!result) throw new Error("expected embedding");
      expect(result.toString("base64")).toBe(embedding.toString("base64"));
    });

    test("removeEmbedding deletes embedding", async () => {
      const s = await getStore();
      const embedding = Buffer.from(new Float32Array([1, 2, 3]).buffer);
      await s.writeEmbedding("mem_rm001", "sess_abc123", embedding);
      expect(await s.getEmbedding("mem_rm001")).not.toBeNull();
      await s.removeEmbedding("mem_rm001");
      expect(await s.getEmbedding("mem_rm001")).toBeNull();
    });

    test("getEmbeddings returns batch results", async () => {
      const s = await getStore();
      const emb1 = Buffer.from(new Float32Array([1, 0, 0]).buffer);
      const emb2 = Buffer.from(new Float32Array([0, 1, 0]).buffer);
      await s.writeEmbedding("mem_batch01", "sess_abc123", emb1);
      await s.writeEmbedding("mem_batch02", "sess_abc123", emb2);
      const map = await s.getEmbeddings(["mem_batch01", "mem_batch02", "mem_missing"]);
      expect(map.size).toBe(2);
      expect(map.has("mem_batch01")).toBe(true);
      expect(map.has("mem_batch02")).toBe(true);
      expect(map.has("mem_missing")).toBe(false);
    });

    test("getEmbeddings returns empty map for empty ids", async () => {
      const s = await getStore();
      const map = await s.getEmbeddings([]);
      expect(map.size).toBe(0);
    });

    test("remove record also removes embedding", async () => {
      const s = await getStore();
      await s.write({
        id: "mem_cascade1",
        scopeKey: "sess_abc123",
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
