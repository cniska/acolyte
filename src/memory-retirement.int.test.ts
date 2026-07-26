import { afterAll, describe, expect, mock, test } from "bun:test";
import type { MemoryRecord } from "./memory-contract";
import * as realEmbedding from "./memory-embedding";
import { createSqliteMemoryStore } from "./memory-store";
import { defaultUserResourceId } from "./resource-id";

// Restoring must re-embed, so the vector has to come from a stub rather than a live provider.
const RESTORED_VEC = new Float32Array([0.4, 0.5, 0.6]);
mock.module("./memory-embedding", () => ({ ...realEmbedding, embedText: async () => RESTORED_VEC }));
afterAll(() => mock.module("./memory-embedding", () => realEmbedding));

const { restoreMemories, retireMemories } = await import("./memory-ops");

const scopeKey = defaultUserResourceId();

function record(id: string, content: string): MemoryRecord {
  return {
    id,
    scopeKey,
    kind: "observation",
    content,
    createdAt: "2026-03-05T10:00:00.000Z",
    tokenEstimate: 2,
  };
}

describe("retirement embedding lifecycle", () => {
  test("retiring drops the embedding and restoring regenerates it", async () => {
    const store = createSqliteMemoryStore(":memory:");
    await store.write(record("mem_embedded01", "a recallable fact"));
    await store.writeEmbedding("mem_embedded01", scopeKey, realEmbedding.embeddingToBuffer(RESTORED_VEC));
    expect(await store.getEmbedding("mem_embedded01")).not.toBeNull();

    await retireMemories(["mem_embedded01"], { kind: "noise" }, { store });
    expect(await store.getEmbedding("mem_embedded01")).toBeNull();

    await restoreMemories(["mem_embedded01"], { store });
    const regenerated = await store.getEmbedding("mem_embedded01");
    expect(regenerated).not.toBeNull();
    if (!regenerated) throw new Error("expected a regenerated embedding");
    const vec = new Float32Array(regenerated.buffer, regenerated.byteOffset, regenerated.byteLength / 4);
    expect(vec[0]).toBeCloseTo(0.4);
    store.close();
  });

  test("restoring an id that was never archived writes no embedding", async () => {
    const store = createSqliteMemoryStore(":memory:");
    await restoreMemories(["mem_neverthere"], { store });
    expect(await store.getEmbedding("mem_neverthere")).toBeNull();
    store.close();
  });
});
