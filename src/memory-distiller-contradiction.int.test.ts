import { afterEach, describe, expect, test } from "bun:test";
import type { MemoryRecord } from "./memory-contract";
import { findContradictions } from "./memory-distiller";
import { embeddingToBuffer } from "./memory-embedding";
import { createSqliteMemoryStore } from "./memory-store";
import { tempDb } from "./test-utils";

const { create, cleanup } = tempDb("acolyte-contradiction-", createSqliteMemoryStore);
afterEach(cleanup);

describe("findContradictions with real store", () => {
  test("supersedes similar observation with different content", async () => {
    const store = create();
    const oldRecord: MemoryRecord = {
      id: "mem_old",
      scopeKey: "proj_test",
      kind: "observation",
      content: "project uses Jest for testing",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    };
    await store.write(oldRecord);
    const vec = new Float32Array([0.9, 0.1, 0, 0]);
    await store.writeEmbedding("mem_old", "proj_test", embeddingToBuffer(vec));

    const similarVec = new Float32Array([0.9, 0.1, 0, 0]);
    const result = await findContradictions(store, "proj_test", "project uses Vitest for testing", similarVec);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mem_old");
  });

  test("does not flag dissimilar observations", async () => {
    const store = create();
    const oldRecord: MemoryRecord = {
      id: "mem_old",
      scopeKey: "proj_test",
      kind: "observation",
      content: "project uses Bun runtime",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 4,
    };
    await store.write(oldRecord);
    await store.writeEmbedding("mem_old", "proj_test", embeddingToBuffer(new Float32Array([1, 0, 0, 0])));

    const orthogonal = new Float32Array([0, 1, 0, 0]);
    const result = await findContradictions(store, "proj_test", "user prefers dark mode", orthogonal);
    expect(result).toHaveLength(0);
  });

  test("ignores stored memories, only checks observations", async () => {
    const store = create();
    const storedRecord: MemoryRecord = {
      id: "mem_stored",
      scopeKey: "proj_test",
      kind: "stored",
      content: "project uses Jest for testing",
      createdAt: "2026-01-01T00:00:00.000Z",
      tokenEstimate: 5,
    };
    await store.write(storedRecord);
    await store.writeEmbedding("mem_stored", "proj_test", embeddingToBuffer(new Float32Array([0.9, 0.1, 0, 0])));

    const result = await findContradictions(
      store,
      "proj_test",
      "project uses Vitest for testing",
      new Float32Array([0.9, 0.1, 0, 0]),
    );
    expect(result).toHaveLength(0);
  });
});
