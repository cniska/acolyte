import { describe, expect, test } from "bun:test";
import { installClientLogSink } from "./chat-app";
import {
  applyAtSuggestion,
  extractAtReferencePaths,
  extractAtReferenceQuery,
  rankAtReferenceSuggestions,
  shouldAutocompleteAtSubmit,
} from "./chat-file-ref";
import { toRows } from "./chat-session";
import { setLogSink } from "./log";
import { createSession } from "./test-utils";

describe("client console capture", () => {
  test("a dependency's console write is logged, not printed", () => {
    const debug = process.env.ACOLYTE_DEBUG;
    delete process.env.ACOLYTE_DEBUG;
    const originalError = console.error;
    const lines: string[] = [];
    let restore: (() => void) | null = null;
    try {
      restore = installClientLogSink();
      // Installed after the capture so the log lines are observable; the sink is the only
      // path the wrapped methods take — `console.*` in Bun writes straight to the terminal.
      setLogSink((line) => lines.push(line));
      expect(console.error).not.toBe(originalError);
      console.error("Maximum update depth exceeded.\n    at Component (file.tsx:1:1)");
      console.warn("deprecation notice");
      console.trace("stack probe");
    } finally {
      restore?.();
      setLogSink(() => {});
      if (debug === undefined) delete process.env.ACOLYTE_DEBUG;
      else process.env.ACOLYTE_DEBUG = debug;
    }
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("source=console.error");
    expect(lines[0]).toContain("level=error");
    // A component stack stays one record, so client.log remains line-oriented.
    expect(lines[0].trimEnd()).not.toContain("\n");
    expect(lines[1]).toContain("level=warn");
    expect(lines[2]).toContain("source=console.trace");
    expect(console.error).toBe(originalError);
  });
});

describe("chat-ui helpers", () => {
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

  test("extractAtReferenceQuery is cursor-aware so an accepted @path closes the picker", () => {
    expect(extractAtReferenceQuery("@src/cl", 7)).toBe("src/cl");
    const accepted = applyAtSuggestion("@src/cl", "src/cli.ts");
    expect(accepted).toBe("@src/cli.ts ");
    // Caret past the completed token and its trailing space: no active token, picker closes.
    expect(extractAtReferenceQuery(accepted, accepted.length)).toBeNull();
    // Caret back inside the token still resolves it.
    expect(extractAtReferenceQuery(accepted, 5)).toBe("src/cli.ts");
    // A caret inside an earlier token selects that one, not the last match.
    expect(extractAtReferenceQuery("@aaa @bbb", 3)).toBe("aaa");
    // Cursor-less callers keep last-match behavior.
    expect(extractAtReferenceQuery(accepted)).toBe("src/cli.ts");
  });

  test("accepting a suggestion applies to the token under the cursor, not the last match", () => {
    // Caret inside the first token: complete it, leave the second mention untouched.
    expect(applyAtSuggestion("@aaa @bbb", "aaa.ts", 2)).toBe("@aaa.ts @bbb");
    expect(shouldAutocompleteAtSubmit("@aaa @bbb", "aaa.ts", 2)).toBe(true);
    expect(shouldAutocompleteAtSubmit("@aaa.ts @bbb", "aaa.ts", 4)).toBe(false);
    // Cursor-less callers keep last-match behavior.
    expect(applyAtSuggestion("@aaa @bbb", "bbb.ts")).toBe("@aaa @bbb.ts ");
  });

  test("extractAtReferencePaths finds unique @paths in a prompt", () => {
    expect(extractAtReferencePaths("review @AGENTS.md and @docs/soul.md")).toEqual(["AGENTS.md", "docs/soul.md"]);
    expect(extractAtReferencePaths("repeat @AGENTS.md and @AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  test("toRows hydrates transcript from resumed session messages", () => {
    const session = createSession({
      id: "sess_resume1",
      messages: [
        { id: "msg_1", role: "system", content: "System context", timestamp: "2026-02-23T00:00:00.000Z" },
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
});
