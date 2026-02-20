import { describe, expect, test } from "bun:test";
import type { Message, SessionStore } from "./types";
import {
  extractAtReferencePaths,
  applyAtSuggestion,
  extractAtReferenceQuery,
  rankAtReferenceSuggestions,
  shouldAutocompleteAtSubmit,
  toRows,
} from "./chat-ui";
import { formatSessionList, resolveResumeSession } from "./chat-commands";

function makeStore(): SessionStore {
  return {
    activeSessionId: "sess_aaaa1111",
    sessions: [
      {
        id: "sess_aaaa1111",
        createdAt: "2026-02-20T10:00:00.000Z",
        updatedAt: "2026-02-20T10:00:00.000Z",
        model: "gpt-5-mini",
        title: "First",
        messages: [],
      },
      {
        id: "sess_bbbb2222",
        createdAt: "2026-02-20T10:10:00.000Z",
        updatedAt: "2026-02-20T10:10:00.000Z",
        model: "gpt-5-mini",
        title: "Second",
        messages: [],
      },
    ],
  };
}

describe("chat-ui helpers", () => {
  test("toRows keeps only user/assistant and applies limit", () => {
    const messages: Message[] = [
      { id: "1", role: "system", content: "x", timestamp: "" },
      { id: "2", role: "user", content: "u1", timestamp: "" },
      { id: "3", role: "assistant", content: "a1", timestamp: "" },
      { id: "4", role: "user", content: "u2", timestamp: "" },
    ];
    const rows = toRows(messages, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.content).toBe("a1");
    expect(rows[1]?.content).toBe("u2");
  });

  test("resolveResumeSession reports usage when no prefix is provided", () => {
    const resolved = resolveResumeSession(makeStore(), "/resume");
    expect(resolved.kind).toBe("usage");
  });

  test("resolveResumeSession reports not_found for unknown prefix", () => {
    const resolved = resolveResumeSession(makeStore(), "/resume sess_missing");
    expect(resolved.kind).toBe("not_found");
    if (resolved.kind === "not_found") {
      expect(resolved.prefix).toBe("sess_missing");
    }
  });

  test("resolveResumeSession reports ambiguous for multi-match prefix", () => {
    const store = makeStore();
    const resolved = resolveResumeSession(store, "/resume sess_");
    expect(resolved.kind).toBe("ambiguous");
    if (resolved.kind === "ambiguous") {
      expect(resolved.matches).toHaveLength(2);
    }
  });

  test("resolveResumeSession returns target session for exact-ish prefix", () => {
    const resolved = resolveResumeSession(makeStore(), "/resume sess_bbbb");
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") {
      expect(resolved.session.id).toBe("sess_bbbb2222");
    }
  });

  test("formatSessionList marks active session", () => {
    const lines = formatSessionList(makeStore());
    expect(lines[0]?.startsWith("* ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
  });

  test("extractAtReferenceQuery parses @prefix", () => {
    expect(extractAtReferenceQuery("@cli")).toBe("cli");
    expect(extractAtReferenceQuery(" @cli")).toBe("cli");
    expect(extractAtReferenceQuery("review @src/cl please")).toBe("src/cl");
    expect(extractAtReferenceQuery("hello")).toBeNull();
  });

  test("rankAtReferenceSuggestions sorts by starts-with then length", () => {
    const ranked = rankAtReferenceSuggestions(
      ["src/chat-ui.tsx", "src/cli.ts", "src/config.ts", "README.md"],
      "c",
      3,
    );
    expect(ranked).toEqual(["src/cli.ts", "src/config.ts", "src/chat-ui.tsx"]);
  });

  test("shouldAutocompleteAtSubmit only intercepts unresolved single @token", () => {
    expect(shouldAutocompleteAtSubmit("@src/cl", "src/cli.ts")).toBe(true);
    expect(shouldAutocompleteAtSubmit("@src/cli.ts", "src/cli.ts")).toBe(false);
    expect(shouldAutocompleteAtSubmit("review @src/cli.ts now", "src/cli.ts")).toBe(false);
    expect(shouldAutocompleteAtSubmit("review @src/cl now", "src/cli.ts")).toBe(true);
    expect(shouldAutocompleteAtSubmit("plain text", "src/cli.ts")).toBe(false);
  });

  test("applyAtSuggestion replaces only active @token", () => {
    expect(applyAtSuggestion("@src/cl", "src/cli.ts")).toBe("@src/cli.ts");
    expect(applyAtSuggestion("review @src/cl now", "src/cli.ts")).toBe("review @src/cli.ts now");
  });

  test("extractAtReferencePaths finds unique @paths in a prompt", () => {
    expect(extractAtReferencePaths("review @AGENTS.md and @docs/soul.md")).toEqual([
      "AGENTS.md",
      "docs/soul.md",
    ]);
    expect(extractAtReferencePaths("repeat @AGENTS.md and @AGENTS.md")).toEqual(["AGENTS.md"]);
  });

});
