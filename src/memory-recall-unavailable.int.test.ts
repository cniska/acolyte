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
let savedModel: string;

beforeAll(() => {
  savedModel = config.embeddingModel;
  config.embeddingModel = "anthropic/claude-opus-4-1";
});
afterAll(() => {
  config.embeddingModel = savedModel;
});

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-recall-down-", createSqliteMemoryStore);
afterEach(cleanupStores);

const userKey = defaultUserResourceId();
const ctx: ScopeContext = { sessionId: "sess_alpha", workspace: "/ws/one" };

function createRecord(content: string): MemoryRecord {
  return {
    id: "mem_0001",
    scopeKey: userKey,
    kind: "stored",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    tokenEstimate: 4,
    topic: null,
  };
}

describe("recall without an embedding", () => {
  test("fails with the embedding-unavailable code instead of returning records", async () => {
    const store = await createStore();
    await store.write(createRecord("a fact worth recalling"), "user");

    const error = await searchMemories("any query", ctx, { store }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe(MEMORY_ERROR_CODES.embeddingUnavailable);
  });

  test("marks nothing as recalled", async () => {
    const store = await createStore();
    await store.write(createRecord("a fact worth recalling"), "user");
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
