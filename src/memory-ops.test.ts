import { describe, expect, test } from "bun:test";
import type { MemoryRecord } from "./memory-contract";
import { listMemories, resolveScopeKey, visibleScopeKeys } from "./memory-ops";
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
    const contents = entries.map((entry) => entry.content);
    expect(contents).toContain("a stored fact");
    expect(contents).toContain("a distilled observation");
    store.close();
  });
});
