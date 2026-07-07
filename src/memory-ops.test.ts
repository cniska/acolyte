import { describe, expect, test } from "bun:test";
import { resolveScopeKey, visibleScopeKeys } from "./memory-ops";
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
