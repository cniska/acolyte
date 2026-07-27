import { describe, expect, test } from "bun:test";
import { createConsolidationBatches, createMemoryConsolidator } from "./memory-consolidator";
import type { MemoryDisposition, MemoryKind, MemoryRecord, MemoryStore } from "./memory-contract";
import { createMemoryPolicy } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";

type RetireCall = { ids: readonly string[]; disposition: MemoryDisposition };

function record(id: string, content: string, topic: string | null = null): MemoryRecord {
  return {
    id: id as MemoryRecord["id"],
    scopeKey: "proj_abc123",
    kind: "observation",
    content,
    topic,
    createdAt: "2026-03-01T00:00:00.000Z",
    tokenEstimate: 4,
  };
}

function createStore(records: MemoryRecord[]) {
  const retired: RetireCall[] = [];
  const written: MemoryRecord[] = [];
  const embeddings = new Map<string, Buffer>();
  const store: MemoryStore = {
    storage: "sqlite",
    async list(options?: { scopeKey?: string; kind?: MemoryKind }) {
      return records.filter(
        (item) =>
          (!options?.scopeKey || item.scopeKey === options.scopeKey) && (!options?.kind || item.kind === options.kind),
      );
    },
    async write(item) {
      records.push(item);
      written.push(item);
    },
    async remove() {},
    async retire(ids, disposition) {
      retired.push({ ids, disposition });
      const present = ids.filter((id) => records.some((item) => item.id === id));
      for (const id of present)
        records.splice(
          records.findIndex((item) => item.id === id),
          1,
        );
      return present;
    },
    async listArchive() {
      return [];
    },
    async restore() {
      return [];
    },
    async touchRecalled() {},
    async writeEmbedding(id, _scopeKey, embedding) {
      embeddings.set(id, embedding);
    },
    async removeEmbedding(id) {
      embeddings.delete(id);
    },
    async getEmbedding(id) {
      return embeddings.get(id) ?? null;
    },
    async getEmbeddings(ids) {
      const found = new Map<string, Buffer>();
      for (const id of ids) {
        const embedding = embeddings.get(id);
        if (embedding) found.set(id, embedding);
      }
      return found;
    },
    close() {},
  };
  return { store, retired, written, embeddings };
}

describe("memory consolidation", () => {
  test("persists a successor before archiving every superseded source", async () => {
    const source = [
      record("mem_old000001", "tests run with bun", "tooling"),
      record("mem_old000002", "use bun for tests", "tooling"),
    ];
    const { store, retired, written } = createStore(source);
    const consolidator = createMemoryConsolidator({
      store,
      policy: createMemoryPolicy(),
      runner: async () => [
        {
          successors: [
            {
              content: "This project runs tests with Bun.",
              topic: "tooling",
              supersedes: ["mem_old000001", "mem_old000002"],
            },
          ],
          noise: [],
        },
      ],
    });

    const result = await consolidator.consolidate("proj_abc123");

    expect(result).toMatchObject({ batches: 1, createdFacts: 1, supersededFacts: 2, retiredNoiseFacts: 0 });
    expect(written).toHaveLength(1);
    const successorId = written[0]?.id;
    if (!successorId) throw new Error("Expected a written successor");
    expect(retired).toEqual([
      { ids: ["mem_old000001"], disposition: { kind: "superseded", by: [successorId] } },
      { ids: ["mem_old000002"], disposition: { kind: "superseded", by: [successorId] } },
    ]);
  });

  test("ignores IDs the model was not shown", async () => {
    const { store, retired } = createStore([record("mem_known0001", "Use Bun.", "tooling")]);
    const consolidator = createMemoryConsolidator({
      store,
      runner: async () => [
        {
          successors: [{ content: "Use Bun.", supersedes: ["mem_unknown01"] }],
          noise: ["mem_unknown01"],
        },
      ],
    });

    expect(await consolidator.consolidate("proj_abc123")).toMatchObject({ createdFacts: 0, supersededFacts: 0 });
    expect(retired).toEqual([]);
  });

  test("only batches untagged records when embeddings make a cluster", async () => {
    const source = [
      record("mem_first0001", "first"),
      record("mem_second001", "second"),
      record("mem_other0002", "other"),
    ];
    const { store, embeddings } = createStore(source);
    embeddings.set("mem_first0001", embeddingToBuffer(new Float32Array([1, 0])));
    embeddings.set("mem_second001", embeddingToBuffer(new Float32Array([0.99, 0.01])));
    embeddings.set("mem_other0002", embeddingToBuffer(new Float32Array([0, 1])));

    const batches = await createConsolidationBatches(
      source,
      store,
      createMemoryPolicy({ consolidationSimilarityThreshold: 0.9 }),
    );

    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([["mem_first0001", "mem_second001"]]);
  });

  test("rejects session scope", async () => {
    const { store } = createStore([]);
    await expect(createMemoryConsolidator({ store }).consolidate("sess_abc123")).rejects.toThrow(
      "Only user and project memories can be consolidated",
    );
  });
});
