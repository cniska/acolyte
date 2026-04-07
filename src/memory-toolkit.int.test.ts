import { afterEach, describe, expect, test } from "bun:test";
import type { MemoryRecord } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";
import { createSqliteMemoryStore } from "./memory-store";
import { searchMemories } from "./memory-toolkit";
import { tempDb } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-toolkit-", createSqliteMemoryStore);
afterEach(cleanupStores);

function makeRecord(id: string, scopeKey: string, content: string): MemoryRecord {
  return { id, scopeKey, kind: "stored", content, createdAt: "2026-01-01T00:00:00.000Z", tokenEstimate: 4 };
}

describe("searchMemories", () => {
  test("returns entries up to the limit", async () => {
    const store = createStore();
    await store.write(makeRecord("mem_a", "user_test", "alpha fact"));
    await store.write(makeRecord("mem_b", "user_test", "beta fact"));
    await store.write(makeRecord("mem_c", "user_test", "gamma fact"));
    const result = await searchMemories("anything", { limit: 2, store });
    expect(result).toHaveLength(2);
  });

  test("returns all entries when limit exceeds count", async () => {
    const store = createStore();
    await store.write(makeRecord("mem_a", "user_test", "only fact"));
    const result = await searchMemories("only", { limit: 10, store });
    expect(result).toHaveLength(1);
  });

  test("returns empty array for empty store", async () => {
    const store = createStore();
    const result = await searchMemories("query", { store });
    expect(result).toEqual([]);
  });

  test("filters by scope", async () => {
    const store = createStore();
    await store.write(makeRecord("mem_u", "user_test", "user preference"));
    await store.write(makeRecord("mem_p", "proj_test", "project convention"));
    const userOnly = await searchMemories("anything", { scope: "user", store });
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0]?.content).toBe("user preference");
    const projectOnly = await searchMemories("anything", { scope: "project", store });
    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]?.content).toBe("project convention");
  });

  test("scope filter applies before limit", async () => {
    const store = createStore();
    await store.write(makeRecord("mem_u1", "user_test", "user a"));
    await store.write(makeRecord("mem_u2", "user_test", "user b"));
    await store.write(makeRecord("mem_p1", "proj_test", "project a"));
    const result = await searchMemories("anything", { scope: "user", limit: 5, store });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.scopeKey.startsWith("user_")).toBe(true);
    }
  });

  test("stores and retrieves pre-computed embeddings", async () => {
    const store = createStore();
    await store.write(makeRecord("mem_a", "user_test", "tool execution uses runTool"));
    await store.write(makeRecord("mem_b", "user_test", "unrelated weather fact"));
    const closeVec = new Float32Array([0.9, 0.1, 0]);
    const farVec = new Float32Array([0, 0, 1]);
    await store.writeEmbedding("mem_a", "user_test", embeddingToBuffer(closeVec));
    await store.writeEmbedding("mem_b", "user_test", embeddingToBuffer(farVec));
    const embA = await store.getEmbedding("mem_a");
    const embB = await store.getEmbedding("mem_b");
    expect(embA).not.toBeNull();
    expect(embB).not.toBeNull();
  });
});
