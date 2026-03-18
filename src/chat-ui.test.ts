import { describe, expect, test } from "bun:test";
import { formatSessionList, resolveResumeSession } from "./chat-commands";
import {
  applyAtSuggestion,
  extractAtReferencePaths,
  extractAtReferenceQuery,
  rankAtReferenceSuggestions,
  shouldAutocompleteAtSubmit,
} from "./chat-file-ref";
import { appendGraduatedItems, applyGraduation } from "./chat-graduation";
import { toRows } from "./chat-session";
import { createSession, createStore } from "./test-utils";

function createUiStore() {
  return createStore({
    activeSessionId: "sess_aaaa1111",
    sessions: [
      createSession({ id: "sess_aaaa1111", title: "First" }),
      createSession({ id: "sess_bbbb2222", title: "Second" }),
    ],
  });
}

describe("chat-ui helpers", () => {
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
    const store = createUiStore();
    const resolved = resolveResumeSession(store, "/resume sess_");
    expect(resolved.kind).toBe("ambiguous");
    if (resolved.kind === "ambiguous") expect(resolved.matches).toHaveLength(2);
  });

  test("resolveResumeSession returns target session for exact-ish prefix", () => {
    const resolved = resolveResumeSession(createUiStore(), "/resume sess_bbbb");
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") expect(resolved.session.id).toBe("sess_bbbb2222");
  });

  test("formatSessionList marks active session", () => {
    const lines = formatSessionList(createUiStore());
    expect(lines[0]?.startsWith("● ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
  });

  test("extractAtReferenceQuery parses @prefix", () => {
    expect(extractAtReferenceQuery("@cli")).toBe("cli");
    expect(extractAtReferenceQuery(" @cli")).toBe("cli");
    expect(extractAtReferenceQuery("review @src/cl please")).toBe("src/cl");
    expect(extractAtReferenceQuery("hello")).toBeNull();
  });

  test("rankAtReferenceSuggestions sorts by starts-with then length", () => {
    const ranked = rankAtReferenceSuggestions(["src/chat-ui.tsx", "src/cli.ts", "src/config.ts", "README.md"], "c", 3);
    expect(ranked).toEqual(["src/cli.ts", "src/config.ts", "src/chat-ui.tsx"]);
  });

  test("rankAtReferenceSuggestions supports partial path segment matching", () => {
    const ranked = rankAtReferenceSuggestions(
      ["src/chat-ui.tsx", "src/chat-message-handler.ts", "docs/project-plan.md"],
      "s/ch-u",
      3,
    );
    expect(ranked[0]).toBe("src/chat-ui.tsx");
  });

  test("rankAtReferenceSuggestions supports fuzzy subsequence matching", () => {
    const ranked = rankAtReferenceSuggestions(["src/chat-ui.tsx", "src/cli.ts", "docs/project-plan.md"], "schui", 3);
    expect(ranked[0]).toBe("src/chat-ui.tsx");
  });

  test("shouldAutocompleteAtSubmit only intercepts unresolved single @token", () => {
    expect(shouldAutocompleteAtSubmit("@src/cl", "src/cli.ts")).toBe(true);
    expect(shouldAutocompleteAtSubmit("@src/cli.ts", "src/cli.ts")).toBe(false);
    expect(shouldAutocompleteAtSubmit("review @src/cli.ts now", "src/cli.ts")).toBe(false);
    expect(shouldAutocompleteAtSubmit("review @src/cl now", "src/cli.ts")).toBe(true);
    expect(shouldAutocompleteAtSubmit("plain text", "src/cli.ts")).toBe(false);
  });

  test("applyAtSuggestion replaces only active @token", () => {
    expect(applyAtSuggestion("@src/cl", "src/cli.ts")).toBe("@src/cli.ts ");
    expect(applyAtSuggestion("review @src/cl now", "src/cli.ts")).toBe("review @src/cli.ts now");
  });

  test("extractAtReferencePaths finds unique @paths in a prompt", () => {
    expect(extractAtReferencePaths("review @AGENTS.md and @docs/soul.md")).toEqual(["AGENTS.md", "docs/soul.md"]);
    expect(extractAtReferencePaths("repeat @AGENTS.md and @AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  test("toRows hydrates transcript from resumed session messages", () => {
    const session = createSession({
      id: "sess_resume1",
      messages: [
        { id: "msg_1", role: "system", content: "Pinned memory", timestamp: "2026-02-23T00:00:00.000Z" },
        { id: "msg_2", role: "user", content: "hello", timestamp: "2026-02-23T00:00:01.000Z" },
        { id: "msg_3", role: "assistant", content: "hi", timestamp: "2026-02-23T00:00:02.000Z" },
      ],
    });
    const rows = toRows(session.messages);
    expect(rows).toEqual([
      { id: "row_2", kind: "user", content: "hello" },
      { id: "row_3", kind: "assistant", content: "hi" },
    ]);
  });

  test("applyGraduation removes captured rows and preserves concurrently added rows", () => {
    const graduated: never[] = [];
    const captured = [
      { id: "row_1", kind: "user" as const, content: "hello" },
      { id: "row_2", kind: "assistant" as const, content: "hi" },
    ];
    // Simulate concurrent addition: live state has captured rows + a new one added during graduation
    const live = [...captured, { id: "row_3", kind: "system" as const, content: "/usage output" }];
    const { nextGraduated, nextLive } = applyGraduation(graduated, captured, live);
    expect(nextGraduated).toEqual(captured);
    expect(nextLive).toEqual([{ id: "row_3", kind: "system", content: "/usage output" }]);
  });

  test("appendGraduatedItems ignores duplicate row ids", () => {
    const initial = [
      { id: "header_sess_demo", kind: "header" as const, lines: [] },
      { id: "row_1", kind: "user" as const, content: "hello" },
    ];
    const next = [
      { id: "row_1", kind: "user" as const, content: "hello" },
      { id: "row_2", kind: "assistant" as const, content: "hi" },
    ];

    expect(appendGraduatedItems(initial, next)).toEqual([
      { id: "header_sess_demo", kind: "header", lines: [] },
      { id: "row_1", kind: "user", content: "hello" },
      { id: "row_2", kind: "assistant", content: "hi" },
    ]);
  });
});
