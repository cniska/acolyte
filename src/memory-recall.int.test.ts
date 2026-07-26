import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { CodedError } from "./coded-error";
import { MEMORY_ERROR_CODES } from "./error-contract";
import type { MemoryRecord } from "./memory-contract";
import type { ScopeContext } from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";
import { searchMemories } from "./memory-toolkit";
import { defaultUserResourceId } from "./resource-id";
import { tempDb } from "./test-utils";

const config = appConfig as { embeddingModel: string };
const NO_EMBEDDING_SUPPORT = "anthropic/claude-opus-4-1";
let savedModel: string;

beforeAll(() => {
  savedModel = config.embeddingModel;
  config.embeddingModel = NO_EMBEDDING_SUPPORT;
});
afterAll(() => {
  config.embeddingModel = savedModel;
});

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-recall-", createSqliteMemoryStore);
afterEach(cleanupStores);

const ctx: ScopeContext = { sessionId: "sess_alpha", workspace: "/ws/one" };

function createRecord(): MemoryRecord {
  return {
    id: "mem_0001",
    scopeKey: defaultUserResourceId(),
    kind: "stored",
    content: "a fact worth recalling",
    createdAt: "2026-01-01T00:00:00.000Z",
    tokenEstimate: 4,
    topic: null,
  };
}

describe("recall without an embedding", () => {
  test("fails with the embedding-unavailable code instead of returning records", async () => {
    const store = await createStore();
    await store.write(createRecord(), "user");

    const error = await searchMemories("any query", ctx, { store }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe(MEMORY_ERROR_CODES.embeddingUnavailable);
    expect((error as CodedError).message).toContain(NO_EMBEDDING_SUPPORT);
  });

  test("marks nothing as recalled", async () => {
    const store = await createStore();
    await store.write(createRecord(), "user");
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
    const store = await createStore();
    expect(await searchMemories("any query", ctx, { store })).toEqual([]);
  });
});
