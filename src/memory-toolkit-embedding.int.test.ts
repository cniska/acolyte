import { afterAll, describe, expect, mock, test } from "bun:test";
import type { MemoryRecord, MemoryStore } from "./memory-contract";
import * as realEmbedding from "./memory-embedding";
import type { ScopeContext } from "./memory-ops";
import { defaultUserResourceId, projectResourceIdFromWorkspace } from "./resource-id";

// searchMemories reaches the searchByEmbedding branch only when embedText returns a
// vector; stub it (and restore after, so it never leaks into other files' tests).
const QUERY_VEC = new Float32Array([0.1, 0.2, 0.3]);
mock.module("./memory-embedding", () => ({ ...realEmbedding, embedText: async () => QUERY_VEC }));
afterAll(() => mock.module("./memory-embedding", () => realEmbedding));

const { searchMemories } = await import("./memory-toolkit");

const WS_ONE = "/ws/one";
const projOne = projectResourceIdFromWorkspace(WS_ONE);
const projTwo = projectResourceIdFromWorkspace("/ws/two");
const userKey = defaultUserResourceId();
const ctx: ScopeContext = { sessionId: "sess_alpha", workspace: WS_ONE };

let seq = 0;
function rec(scopeKey: string, content: string): MemoryRecord {
  seq += 1;
  return {
    id: `mem_${String(seq).padStart(4, "0")}`,
    scopeKey,
    kind: "observation",
    content,
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    tokenEstimate: 4,
    topic: null,
  };
}

function fakeCloudStore(records: MemoryRecord[]): MemoryStore {
  return {
    async list() {
      return records;
    },
    async write() {},
    async remove() {},
    async touchRecalled() {},
    async writeEmbedding() {},
    async removeEmbedding() {},
    async getEmbedding() {
      return null;
    },
    async getEmbeddings() {
      return new Map();
    },
    async searchByEmbedding(_vec, opts) {
      return records.slice(0, opts.limit);
    },
    close() {},
  };
}

const contents = (records: readonly MemoryRecord[]): string[] => records.map((r) => r.content);

describe("searchMemories searchByEmbedding (cloud) path", () => {
  test("filters to the visible scope set", async () => {
    const store = fakeCloudStore([
      rec(projOne, "project one fact"),
      rec(projTwo, "project two secret"),
      rec(userKey, "user pref"),
      rec("sess_alpha", "current session note"),
      rec("sess_beta", "other session note"),
    ]);
    const got = contents(await searchMemories("anything", ctx, { store }));
    expect(got).toContain("project one fact");
    expect(got).toContain("user pref");
    expect(got).toContain("current session note");
    expect(got).not.toContain("project two secret");
    expect(got).not.toContain("other session note");
  });

  test("honors the scope option", async () => {
    const store = fakeCloudStore([rec(projOne, "project fact"), rec(userKey, "user pref")]);
    const got = contents(await searchMemories("anything", ctx, { scope: "user", store }));
    expect(got).toEqual(["user pref"]);
  });
});
