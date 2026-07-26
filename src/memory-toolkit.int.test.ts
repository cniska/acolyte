import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  EMBED_FAILURE_TRIGGER,
  type FakeProviderServer,
  startFakeProviderServer,
} from "../scripts/fake-provider-server";
import { appConfig } from "./app-config";
import { CodedError } from "./coded-error";
import { MEMORY_ERROR_CODES } from "./error-contract";
import type { MemoryRecord } from "./memory-contract";
import type { ScopeContext } from "./memory-ops";
import { searchMemories } from "./memory-recall";
import { createSqliteMemoryStore } from "./memory-store";
import { searchMemories } from "./memory-toolkit";
import { defaultUserResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import { tempDb } from "./test-utils";

const config = appConfig as { embeddingModel: string };
const openai = appConfig.openai as { baseUrl: string; apiKey: string | undefined };
let fake: FakeProviderServer;
let savedModel: string;
let savedBaseUrl: string;
let savedApiKey: string | undefined;

beforeAll(() => {
  savedModel = config.embeddingModel;
  savedBaseUrl = openai.baseUrl;
  savedApiKey = openai.apiKey;
  fake = startFakeProviderServer();
  config.embeddingModel = "text-embedding-3-large";
  openai.baseUrl = fake.baseUrl;
  openai.apiKey = "fake-key";
});
afterAll(() => {
  fake.stop();
  config.embeddingModel = savedModel;
  openai.baseUrl = savedBaseUrl;
  openai.apiKey = savedApiKey;
});

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-toolkit-", createSqliteMemoryStore);
afterEach(cleanupStores);

const WS_ONE = "/ws/one";
const WS_TWO = "/ws/two";
const projOne = projectResourceIdFromWorkspace(WS_ONE);
const projTwo = projectResourceIdFromWorkspace(WS_TWO);
const userKey = defaultUserResourceId();

const ctx: ScopeContext = { sessionId: "sess_alpha", workspace: WS_ONE };

let seq = 0;
function createRecord(
  scopeKey: string,
  content: string,
  kind: MemoryRecord["kind"] = "stored",
  createdAt = `2026-01-01T00:00:${String(seq + 1).padStart(2, "0")}.000Z`,
): MemoryRecord {
  seq += 1;
  return {
    id: `mem_${String(seq).padStart(4, "0")}`,
    scopeKey,
    kind,
    content,
    createdAt,
    tokenEstimate: 4,
  };
}

const contents = (records: readonly MemoryRecord[]): string[] => records.map((r) => r.content);

describe("searchMemories scope visibility", () => {
  test("round-trips a fact written in the same context", async () => {
    const store = createStore();
    await store.write(createRecord(projOne, "project one convention"));
    const results = await searchMemories("anything", ctx, { store });
    expect(contents(results)).toContain("project one convention");
  });

  test("isolates memories from other projects", async () => {
    const store = createStore();
    await store.write(createRecord(projOne, "project one convention"));
    await store.write(createRecord(projTwo, "project two secret"));
    const results = await searchMemories("anything", ctx, { store });
    expect(contents(results)).toContain("project one convention");
    expect(contents(results)).not.toContain("project two secret");
  });

  test("isolates memories from other sessions but surfaces the current session", async () => {
    const store = createStore();
    await store.write(createRecord("sess_alpha", "current session note", "observation"));
    await store.write(createRecord("sess_beta", "other session note", "observation"));
    const results = await searchMemories("anything", ctx, { store });
    expect(contents(results)).toContain("current session note");
    expect(contents(results)).not.toContain("other session note");
  });

  test("always surfaces user-scoped memories", async () => {
    const store = createStore();
    await store.write(createRecord(userKey, "cross-project preference"));
    const results = await searchMemories("anything", ctx, { store });
    expect(contents(results)).toContain("cross-project preference");
  });

  test("a sessionless context hides session memories", async () => {
    const store = createStore();
    await store.write(createRecord("sess_alpha", "session note", "observation"));
    await store.write(createRecord(userKey, "durable pref"));
    const results = await searchMemories("anything", { workspace: WS_ONE }, { store });
    expect(contents(results)).not.toContain("session note");
    expect(contents(results)).toContain("durable pref");
  });

  test("a workspaceless context hides project memories, never defaulting to cwd", async () => {
    const store = createStore();
    await store.write(createRecord(projOne, "project fact"));
    await store.write(createRecord(userKey, "durable pref"));
    const results = await searchMemories("anything", { sessionId: "sess_alpha" }, { store });
    expect(contents(results)).not.toContain("project fact");
    expect(contents(results)).toContain("durable pref");
  });
});

describe("searchMemories scope option", () => {
  test("intersects to a single scope within the visible set", async () => {
    const store = createStore();
    await store.write(createRecord(userKey, "user pref"));
    await store.write(createRecord(projOne, "project fact"));
    await store.write(createRecord("sess_alpha", "session note", "observation"));

    expect(contents(await searchMemories("anything", ctx, { scope: "user", store }))).toEqual(["user pref"]);
    expect(contents(await searchMemories("anything", ctx, { scope: "project", store }))).toEqual(["project fact"]);
    expect(contents(await searchMemories("anything", ctx, { scope: "session", store }))).toEqual(["session note"]);
  });

  test("returns nothing when the requested scope is not in the context", async () => {
    const store = createStore();
    await store.write(createRecord(projOne, "project fact"));
    const results = await searchMemories("anything", { workspace: WS_ONE }, { scope: "session", store });
    expect(results).toEqual([]);
  });
});

describe("searchMemories basics", () => {
  test("returns entries up to the limit", async () => {
    const store = createStore();
    await store.write(createRecord(userKey, "alpha fact"));
    await store.write(createRecord(userKey, "beta fact"));
    await store.write(createRecord(userKey, "gamma fact"));
    const results = await searchMemories("anything", ctx, { limit: 2, store });
    expect(results).toHaveLength(2);
  });

  test("falls back to the most recent records when embeddings are unavailable", async () => {
    const store = createStore();
    await store.write(createRecord(userKey, "oldest fact", "stored", "2026-01-01T00:00:01.000Z"));
    await store.write(createRecord(userKey, "middle fact", "stored", "2026-01-01T00:00:02.000Z"));
    await store.write(createRecord(userKey, "newest fact", "stored", "2026-01-01T00:00:03.000Z"));

    const results = await searchMemories("anything", ctx, { embed: async () => null, limit: 2, store });

    expect(contents(results)).toEqual(["newest fact", "middle fact"]);
  });

  test("returns an empty array for an empty store", async () => {
    const store = createStore();
    const results = await searchMemories("anything", ctx, { store });
    expect(results).toEqual([]);
  });
});

describe("searchMemories when the embedding request fails", () => {
  test("wraps the provider failure, preserving its cause", async () => {
    const store = createStore();
    await store.write(createRecord(userKey, "a fact worth recalling"));

    const error = await searchMemories(EMBED_FAILURE_TRIGGER, ctx, { store }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe(MEMORY_ERROR_CODES.embeddingUnavailable);
    expect((error as CodedError).cause).toBeDefined();
  });
});
