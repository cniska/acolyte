import { describe, expect, test } from "bun:test";
import { resolveResumeSession } from "./chat-commands-resume";
import { createSession, createSessionState } from "./test-utils";

function createUiStore() {
  return createSessionState({
    activeSessionId: "sess_aaaa1111",
    sessions: [
      createSession({ id: "sess_aaaa1111", title: "First" }),
      createSession({ id: "sess_bbbb2222", title: "Second" }),
    ],
  });
}

describe("chat-commands-resume", () => {
  test("resolveResumeSession reports usage when no prefix is provided", () => {
    const resolved = resolveResumeSession(createUiStore(), "/resume");
    expect(resolved.kind).toBe("usage");
  });

  test("resolveResumeSession reports not_found for unknown prefix", () => {
    const resolved = resolveResumeSession(createUiStore(), "/resume sess_missing");
    expect(resolved.kind).toBe("not_found");
    if (resolved.kind === "not_found") expect(resolved.prefix).toBe("sess_missing");
  });

  test("resolveResumeSession reports ambiguous for multi-match prefix", () => {
    const resolved = resolveResumeSession(createUiStore(), "/resume sess_");
    expect(resolved.kind).toBe("ambiguous");
    if (resolved.kind === "ambiguous") expect(resolved.matches).toHaveLength(2);
  });

  test("resolveResumeSession returns target session for exact-ish prefix", () => {
    const resolved = resolveResumeSession(createUiStore(), "/resume sess_bbbb");
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") expect(resolved.session.id).toBe("sess_bbbb2222");
  });
});
