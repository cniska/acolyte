import { describe, expect, test } from "bun:test";
import { CloudApiError } from "./cloud-client";
import { setLogSink } from "./log";
import type { MemoryRecord, MemoryStore } from "./memory-contract";
import { mergeLocalUserScope } from "./user-scope-merge";

const ACCOUNT_KEY = "user_abc123def456" as const;

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "mem_local0001",
    scopeKey: overrides.scopeKey ?? "user_local",
    content: overrides.content ?? "Prefers concise output.",
    createdAt: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
    tokenEstimate: overrides.tokenEstimate ?? 5,
    topic: overrides.topic ?? null,
  };
}

type FakeStore = MemoryStore & {
  rows: MemoryRecord[];
  written: MemoryRecord[];
  embeddings: { id: string; scopeKey: string }[];
  removed: string[];
};

function createStore(options: { rows?: MemoryRecord[]; embeddingsFor?: string[]; failWriteFor?: string[] } = {}) {
  const rows = [...(options.rows ?? [])];
  const written: MemoryRecord[] = [];
  const embeddings: { id: string; scopeKey: string }[] = [];
  const removed: string[] = [];
  const store = {
    storage: "sqlite" as const,
    rows,
    written,
    embeddings,
    removed,
    list: async (query?: { scopeKey?: string }) =>
      query?.scopeKey ? rows.filter((row) => row.scopeKey === query.scopeKey) : rows,
    write: async (entry: MemoryRecord) => {
      if (options.failWriteFor?.includes(entry.id)) throw new Error("write refused");
      written.push(entry);
      rows.push(entry);
    },
    writeEmbedding: async (id: string, scopeKey: string) => {
      embeddings.push({ id, scopeKey });
    },
    getEmbedding: async (id: string) =>
      options.embeddingsFor?.includes(id) ? Buffer.from(new Float32Array([0.5]).buffer) : null,
    remove: async (id: string) => {
      removed.push(id);
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) rows.splice(at, 1);
    },
    listArchive: async () => [],
    retire: async (ids: string[]) => ids,
    restore: async () => [],
    touchRecalled: async () => {},
    removeEmbedding: async () => {},
    getEmbeddings: async () => new Map<string, Buffer>(),
    close: () => {},
  };
  return store as FakeStore;
}

describe("mergeLocalUserScope", () => {
  test("moves a local record into the account under the account's key", async () => {
    const local = createStore({ rows: [record({ id: "mem_local0001" })], embeddingsFor: ["mem_local0001"] });
    const cloud = createStore();

    const summary = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });

    expect(summary).toEqual({ merged: 1, duplicates: 0, failures: 0, embeddingFailures: 0 });
    expect(cloud.written).toEqual([{ ...record({ id: "mem_local0001" }), scopeKey: ACCOUNT_KEY }]);
    expect(cloud.embeddings).toEqual([{ id: "mem_local0001", scopeKey: ACCOUNT_KEY }]);
    expect(local.removed).toEqual(["mem_local0001"]);
  });

  test("drops a local observation the account already holds, whatever its whitespace", async () => {
    const local = createStore({ rows: [record({ id: "mem_local0001", content: "Prefers   concise\noutput. " })] });
    const cloud = createStore({ rows: [record({ id: "mem_cloud0001", scopeKey: ACCOUNT_KEY })] });

    const summary = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });

    expect(summary.duplicates).toBe(1);
    expect(summary.merged).toBe(0);
    expect(cloud.written).toEqual([]);
    expect(local.removed).toEqual(["mem_local0001"]);
  });

  test("moves one of two local observations that say the same thing", async () => {
    const local = createStore({
      rows: [
        record({ id: "mem_local0001", content: "Prefers concise output." }),
        record({ id: "mem_local0002", content: "Prefers   concise output. " }),
      ],
    });
    const cloud = createStore();

    const summary = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });

    expect(summary).toMatchObject({ merged: 1, duplicates: 1 });
    expect(cloud.written.map((row) => row.id)).toEqual(["mem_local0001"]);
    expect(local.rows).toEqual([]);
  });

  test("keeps a local record whose write failed, so the next login retries it", async () => {
    setLogSink(() => {});
    const local = createStore({ rows: [record({ id: "mem_local0001" })] });
    const cloud = createStore({ failWriteFor: ["mem_local0001"] });

    const summary = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });

    expect(summary.failures).toBe(1);
    expect(local.removed).toEqual([]);
    expect(local.rows).toHaveLength(1);
    setLogSink(null);
  });

  test("stops on a refused credential instead of counting every record against it", async () => {
    const local = createStore({ rows: [record({ id: "mem_local0001" }), record({ id: "mem_local0002" })] });
    const cloud = createStore();
    cloud.write = async () => {
      throw new CloudApiError(401, "unauthorized");
    };

    await expect(
      mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY }),
    ).rejects.toThrow();
    expect(local.removed).toEqual([]);
  });

  test("finishes a move the previous run left half done, and then does nothing", async () => {
    const local = createStore({ rows: [record({ id: "mem_local0001" })] });
    const cloud = createStore({ rows: [{ ...record({ id: "mem_local0001" }), scopeKey: ACCOUNT_KEY }] });

    const first = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });
    const second = await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY });

    expect(first.duplicates).toBe(1);
    expect(local.rows).toEqual([]);
    expect(second).toEqual({ merged: 0, duplicates: 0, failures: 0, embeddingFailures: 0 });
  });

  test("leaves the account alone when this installation remembered nothing", async () => {
    const local = createStore();
    const cloud = createStore({ rows: [record({ id: "mem_cloud0001", scopeKey: ACCOUNT_KEY })] });

    expect(await mergeLocalUserScope({ localMemory: local, cloudMemory: cloud, accountKey: ACCOUNT_KEY })).toEqual({
      merged: 0,
      duplicates: 0,
      failures: 0,
      embeddingFailures: 0,
    });
    expect(cloud.written).toEqual([]);
  });
});
