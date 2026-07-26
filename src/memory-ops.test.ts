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
import { defaultUserResourceId, projectResourceIdFromWorkspace } from "./resource-id";

describe("resolveScopeKey", () => {
  test("session resolves to the session id, or null when absent", () => {
    expect(resolveScopeKey("session", { sessionId: "sess_alpha" })).toBe("sess_alpha");
    expect(resolveScopeKey("session", {})).toBeNull();
    expect(resolveScopeKey("session", {}, { strict: true })).toBeNull();
  });

  test("user always resolves, honoring a user_ resourceId override", () => {
    expect(resolveScopeKey("user", {})).toBe(defaultUserResourceId());
    expect(resolveScopeKey("user", { resourceId: "user_override1" })).toBe("user_override1");
  });

  test("project derives from workspace path", () => {
    expect(resolveScopeKey("project", { workspace: "/ws/one" })).toBe(projectResourceIdFromWorkspace("/ws/one"));
  });

  test("project prefers a proj_ resourceId over workspace", () => {
    const key = resolveScopeKey("project", { workspace: "/ws/one", resourceId: "proj_explicit1" });
    expect(key).toBe("proj_explicit1");
  });

  test("project is strict: no workspace/resourceId yields no key, never a cwd fallback", () => {
    expect(resolveScopeKey("project", {}, { strict: true })).toBeNull();
    expect(resolveScopeKey("project", {})).toBe(projectResourceIdFromWorkspace(process.cwd()));
  });

  test("distinct workspaces resolve to distinct project keys", () => {
    const one = resolveScopeKey("project", { workspace: "/ws/one" });
    const two = resolveScopeKey("project", { workspace: "/ws/two" });
    expect(one).not.toBe(two);
  });
});

describe("visibleScopeKeys", () => {
  test("full context exposes session, project, and user keys", () => {
    const keys = visibleScopeKeys({ sessionId: "sess_alpha", workspace: "/ws/one" });
    expect(keys).toEqual(new Set(["sess_alpha", projectResourceIdFromWorkspace("/ws/one"), defaultUserResourceId()]));
  });

  test("user scope is always visible", () => {
    expect(visibleScopeKeys({}).has(defaultUserResourceId())).toBe(true);
  });

  test("sessionless context hides the session key", () => {
    const keys = visibleScopeKeys({ workspace: "/ws/one" });
    expect(keys.has("sess_alpha")).toBe(false);
    expect(keys.has(projectResourceIdFromWorkspace("/ws/one"))).toBe(true);
  });

  test("workspaceless context hides the project key (no cwd fallback)", () => {
    const keys = visibleScopeKeys({ sessionId: "sess_alpha" });
    expect(keys.has(projectResourceIdFromWorkspace(process.cwd()))).toBe(false);
    expect(keys).toEqual(new Set(["sess_alpha", defaultUserResourceId()]));
  });
});

describe("addObservation", () => {
  test("skips a repeat within a scope but keeps the same fact in a different scope", async () => {
    const store = createSqliteMemoryStore(":memory:");
    const fact = "the build runs on bun";
    const userScope = defaultUserResourceId();
    const projectScope = projectResourceIdFromWorkspace("/tmp/some-project");

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
    const scopeKey = defaultUserResourceId();
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
  const scopeKey = defaultUserResourceId();
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
