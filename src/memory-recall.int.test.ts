import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { CodedError } from "./coded-error";
import { MEMORY_ERROR_CODES } from "./error-contract";
import type { MemoryRecord } from "./memory-contract";
import type { ScopeContext } from "./memory-ops";
import { searchMemories } from "./memory-recall";
import { createSqliteMemoryStore } from "./memory-store";
import { pinEmbeddingProviders, tempDb } from "./test-utils";

const NO_EMBEDDING_SUPPORT = "anthropic/claude-opus-4-1";
let restoreProviders: () => void;

// No provider credentials at all, so nothing can embed and recall has to fail rather than rank.
beforeAll(() => {
  restoreProviders = pinEmbeddingProviders({ embeddingModel: NO_EMBEDDING_SUPPORT });
});
afterAll(() => restoreProviders());

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-recall-", createSqliteMemoryStore);
afterEach(cleanupStores);

const ctx: ScopeContext = { sessionId: "sess_alpha", workspace: "/ws/one" };

function createRecord(): MemoryRecord {
  return {
    id: "mem_0001",
    scopeKey: "user_local",
    content: "a fact worth recalling",
    createdAt: "2026-01-01T00:00:00.000Z",
    tokenEstimate: 4,
    topic: null,
  };
}

describe("recall without an embedding", () => {
  test("fails with the embedding-unavailable code instead of returning records", async () => {
    const store = createStore();
    await store.write(createRecord());

    const error = await searchMemories("any query", ctx, { store }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe(MEMORY_ERROR_CODES.embeddingUnavailable);
    expect((error as CodedError).message).toContain(NO_EMBEDDING_SUPPORT);
  });

  test("marks nothing as recalled", async () => {
    const store = createStore();
    await store.write(createRecord());
    const touched: string[] = [];
    const realTouch = store.touchRecalled.bind(store);
    store.touchRecalled = async (ids) => {
      touched.push(...ids);
      return await realTouch(ids);
    };

    await searchMemories("any query", ctx, { store }).catch(() => undefined);
    expect(touched).toEqual([]);
  });

  test("an empty corpus still returns no records rather than failing", async () => {
    const store = createStore();
    expect(await searchMemories("any query", ctx, { store })).toEqual([]);
  });
});
