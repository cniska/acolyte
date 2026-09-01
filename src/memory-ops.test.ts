import { describe, expect, test } from "bun:test";
import type { MemoryRecord, MemoryStore } from "./memory-contract";
import {
  addObservation,
  listArchivedMemories,
  listMemories,
  resolveScopeKey,
  restoreMemories,
  retireMemories,
  visibleScopeKeys,
} from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";

const PROJECT_KEY = "proj_abc123";

describe("resolveScopeKey", () => {
  test("session resolves to the session id, or null when absent", () => {
    expect(resolveScopeKey("session", { sessionId: "sess_alpha" })).toBe("sess_alpha");
    expect(resolveScopeKey("session", {})).toBeNull();
    expect(resolveScopeKey("session", {})).toBeNull();
  });

  test("user always resolves, honoring a user_ resourceId override", () => {
    expect(resolveScopeKey("user", {})).toBe("user_local");
    expect(resolveScopeKey("user", { resourceId: "user_override1" })).toBe("user_override1");
  });

  test("project needs a repository remote: a workspace without one yields no key", () => {
    expect(resolveScopeKey("project", { workspace: "/ws/one" })).toBeNull();
  });

  test("project prefers a proj_ resourceId over workspace", () => {
    const key = resolveScopeKey("project", { workspace: "/ws/one", resourceId: PROJECT_KEY });
    expect(key).toBe(PROJECT_KEY);
  });

  test("project yields no key without a workspace, never a cwd fallback", () => {
    expect(resolveScopeKey("project", {})).toBeNull();
  });
});

describe("visibleScopeKeys", () => {
  test("full context exposes session, project, and user keys", () => {
    const keys = visibleScopeKeys({ sessionId: "sess_alpha", resourceId: PROJECT_KEY });
    expect(keys).toEqual(new Set(["sess_alpha", PROJECT_KEY, "user_local"]));
  });

  test("user scope is always visible", () => {
    expect(visibleScopeKeys({}).has("user_local")).toBe(true);
  });

  test("sessionless context hides the session key", () => {
    const keys = visibleScopeKeys({ resourceId: PROJECT_KEY });
    expect(keys.has("sess_alpha")).toBe(false);
    expect(keys.has(PROJECT_KEY)).toBe(true);
  });

  test("a workspace with no project scope hides the project key, never falling back to cwd", () => {
    const keys = visibleScopeKeys({ sessionId: "sess_alpha", workspace: "/ws/one" });
    expect(keys).toEqual(new Set(["sess_alpha", "user_local"]));
  });
});

describe("addObservation", () => {
  test("skips a repeat within a scope but keeps the same fact in a different scope", async () => {
    const store = createSqliteMemoryStore(":memory:");
    const fact = "the build runs on bun";
    const userScope = "user_local";
    const projectScope = PROJECT_KEY;

    expect(await addObservation(userScope, fact, { store })).not.toBeNull();
    expect(await addObservation(userScope, fact, { store })).toBeNull();
    expect(await addObservation(projectScope, fact, { store })).not.toBeNull();

    expect((await store.list({ scopeKey: userScope })).length).toBe(1);
    expect((await store.list({ scopeKey: projectScope })).length).toBe(1);
    store.close();
  });
});

describe("listMemories", () => {
  // Regression: the list used to filter kind:"stored", hiding distilled observations.
  test("returns both stored memories and observations", async () => {
    const store = createSqliteMemoryStore(":memory:");
    const scopeKey = "user_local";
    const base = { scopeKey, createdAt: "2026-03-05T10:00:00.000Z", tokenEstimate: 1 };
    const records: MemoryRecord[] = [
      { ...base, id: "mem_stored01", kind: "stored", content: "a stored fact" },
      { ...base, id: "mem_obs01", kind: "observation", content: "a distilled observation" },
    ];
    for (const record of records) await store.write(record);

    const entries = await listMemories({ scope: "user", store });
    const byContent = new Map(entries.map((entry) => [entry.content, entry.kind]));
    expect(byContent.get("a stored fact")).toBe("stored");
    expect(byContent.get("a distilled observation")).toBe("observation");
    store.close();
  });
});

describe("retirement ops", () => {
  const scopeKey = "user_local";
  const base = { scopeKey, createdAt: "2026-03-05T10:00:00.000Z", tokenEstimate: 1 };

  async function seededStore(): Promise<MemoryStore> {
    const store = createSqliteMemoryStore(":memory:");
    const records: MemoryRecord[] = [
      { ...base, id: "mem_keep00001", kind: "observation", content: "the fact that survives" },
      { ...base, id: "mem_drop00001", kind: "observation", content: "a duplicate of the fact" },
    ];
    for (const record of records) await store.write(record);
    return store;
  }

  test("retiring hides a record from the active list and shows it in the archive", async () => {
    const store = await seededStore();
    await retireMemories(["mem_drop00001"], { kind: "superseded", by: ["mem_keep00001"] }, { store });

    const active = await listMemories({ scope: "user", store });
    expect(active.map((entry) => entry.id)).toEqual(["mem_keep00001"]);

    const archived = await listArchivedMemories({ scope: "user", store });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe("mem_drop00001");
    expect(archived[0]?.disposition).toEqual({ kind: "superseded", by: ["mem_keep00001"] });
    store.close();
  });

  test("retiring deduplicates and trims the id list", async () => {
    const store = await seededStore();
    const retired = await retireMemories([" mem_drop00001 ", "mem_drop00001", "  "], { kind: "noise" }, { store });
    expect(retired).toEqual(["mem_drop00001"]);
    expect(await listArchivedMemories({ scope: "user", store })).toHaveLength(1);
    store.close();
  });

  test("retiring rejects a superseded disposition naming no successor", async () => {
    const store = await seededStore();
    await expect(
      retireMemories(["mem_drop00001"], { kind: "superseded", by: [] } as never, { store }),
    ).rejects.toThrow();
    expect(await listMemories({ scope: "user", store })).toHaveLength(2);
    expect(await listArchivedMemories({ scope: "user", store })).toHaveLength(0);
    store.close();
  });

  test("retiring nothing is a no-op", async () => {
    const store = await seededStore();
    expect(await retireMemories([], { kind: "noise" }, { store })).toEqual([]);
    expect(await listMemories({ scope: "user", store })).toHaveLength(2);
    store.close();
  });

  test("the archive filters by disposition", async () => {
    const store = await seededStore();
    await retireMemories(["mem_drop00001"], { kind: "noise" }, { store });
    expect(await listArchivedMemories({ scope: "user", store, disposition: "noise" })).toHaveLength(1);
    expect(await listArchivedMemories({ scope: "user", store, disposition: "capacity" })).toHaveLength(0);
    store.close();
  });

  test("restoring returns a record to the active list", async () => {
    const store = await seededStore();
    await retireMemories(["mem_drop00001"], { kind: "noise" }, { store });
    const restored = await restoreMemories(["mem_drop00001"], { store });

    expect(restored.map((entry) => entry.id)).toEqual(["mem_drop00001"]);
    const active = await listMemories({ scope: "user", store });
    expect(active.map((entry) => entry.id).sort()).toEqual(["mem_drop00001", "mem_keep00001"]);
    expect(await listArchivedMemories({ scope: "user", store })).toHaveLength(0);
    store.close();
  });

  test("restoring an unknown id returns nothing and changes nothing", async () => {
    const store = await seededStore();
    expect(await restoreMemories(["mem_nosuchrec"], { store })).toEqual([]);
    expect(await listMemories({ scope: "user", store })).toHaveLength(2);
    store.close();
  });
});
