import { describe, expect, test } from "bun:test";
import type { MemoryStore } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";
import { memoryStoreContractTests } from "./memory-store-contract.test-suite";
import { createPostgresMemoryStore } from "./memory-store-postgres";

const POSTGRES_TEST_URL = process.env.POSTGRES_TEST_URL;

if (!POSTGRES_TEST_URL) {
  test.skip("skipping Postgres tests (POSTGRES_TEST_URL not set)", () => {});
} else {
  const url = POSTGRES_TEST_URL;
  const stores: MemoryStore[] = [];

  async function createStore(): Promise<MemoryStore> {
    const store = await createPostgresMemoryStore(url);
    stores.push(store);
    return store;
  }

  async function cleanup(): Promise<void> {
    if (stores.length === 0) return;
    const postgres = (await import("postgres")).default;
    const sql = postgres(url);
    await sql`TRUNCATE memories, memory_embeddings`;
    await sql.end();
    for (const s of stores.splice(0)) s.close();
  }

  memoryStoreContractTests("Postgres", { create: createStore, cleanup });

  describe("Postgres searchByEmbedding", () => {
    test("returns records ranked by cosine similarity", async () => {
      const store = await createStore();

      await store.write({
        id: "mem_close01",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "close to query",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 3,
      });
      await store.write({
        id: "mem_far001",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "far from query",
        createdAt: "2026-03-04T12:00:01.000Z",
        tokenEstimate: 3,
      });

      const queryVec = new Float32Array(1536).fill(0);
      queryVec[0] = 1;

      const closeVec = new Float32Array(1536).fill(0);
      closeVec[0] = 0.9;
      closeVec[1] = 0.1;

      const farVec = new Float32Array(1536).fill(0);
      farVec[500] = 1;

      await store.writeEmbedding("mem_close01", "user_abc123", embeddingToBuffer(closeVec));
      await store.writeEmbedding("mem_far001", "user_abc123", embeddingToBuffer(farVec));

      expect(store.searchByEmbedding).toBeDefined();
      const results = await store.searchByEmbedding?.(queryVec, { kind: "stored", limit: 10 });
      expect(results).toHaveLength(2);
      expect(results?.[0]?.id).toBe("mem_close01");
      expect(results?.[1]?.id).toBe("mem_far001");

      await cleanup();
    });

    test("respects limit", async () => {
      const store = await createStore();

      for (let i = 0; i < 5; i++) {
        const id = `mem_lim${String(i).padStart(3, "0")}`;
        await store.write({
          id,
          scopeKey: "user_abc123",
          kind: "stored",
          content: `memory ${i}`,
          createdAt: `2026-03-04T12:00:0${i}.000Z`,
          tokenEstimate: 2,
        });
        const vec = new Float32Array(1536).fill(0);
        vec[i] = 1;
        await store.writeEmbedding(id, "user_abc123", embeddingToBuffer(vec));
      }

      const queryVec = new Float32Array(1536).fill(0);
      queryVec[0] = 1;

      const results = await store.searchByEmbedding?.(queryVec, { kind: "stored", limit: 2 });
      expect(results).toHaveLength(2);

      await cleanup();
    });

    test("filters by scopeKey", async () => {
      const store = await createStore();

      await store.write({
        id: "mem_scope01",
        scopeKey: "user_abc123",
        kind: "stored",
        content: "user memory",
        createdAt: "2026-03-04T12:00:00.000Z",
        tokenEstimate: 2,
      });
      await store.write({
        id: "mem_scope02",
        scopeKey: "proj_def456",
        kind: "stored",
        content: "project memory",
        createdAt: "2026-03-04T12:00:01.000Z",
        tokenEstimate: 2,
      });

      const vec = new Float32Array(1536).fill(0);
      vec[0] = 1;
      await store.writeEmbedding("mem_scope01", "user_abc123", embeddingToBuffer(vec));
      await store.writeEmbedding("mem_scope02", "proj_def456", embeddingToBuffer(vec));

      const queryVec = new Float32Array(1536).fill(0);
      queryVec[0] = 1;

      const results = await store.searchByEmbedding?.(queryVec, {
        scopeKey: "user_abc123",
        kind: "stored",
        limit: 10,
      });
      expect(results).toHaveLength(1);
      expect(results?.[0]?.id).toBe("mem_scope01");

      await cleanup();
    });
  });
}
