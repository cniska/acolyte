import { describe, expect, test } from "bun:test";
import {
  applyAtSuggestion,
  extractAtReferencePaths,
  extractAtReferenceQuery,
  rankAtReferenceSuggestions,
  shouldAutocompleteAtSubmit,
} from "./chat-file-ref";
import { appendPromotedItems, applyPromotion } from "./chat-promotion";
import { toRows } from "./chat-session";
import { createSession } from "./test-utils";

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

  test("applyPromotion removes captured rows and preserves concurrently added rows", () => {
    const promoted: never[] = [];
    const captured = [
      { id: "row_1", kind: "user" as const, content: "hello" },
      { id: "row_2", kind: "assistant" as const, content: "hi" },
    ];
    // Simulate concurrent addition: live state has captured rows + a new one added during promotion
    const live = [...captured, { id: "row_3", kind: "system" as const, content: "/usage output" }];
    const { nextPromoted, nextLive } = applyPromotion(promoted, captured, live);
    expect(nextPromoted).toEqual(captured);
    expect(nextLive).toEqual([{ id: "row_3", kind: "system", content: "/usage output" }]);
  });

  test("appendPromotedItems ignores duplicate row ids", () => {
    const initial = [
      { id: "header_sess_demo", kind: "header" as const, lines: [] },
      { id: "row_1", kind: "user" as const, content: "hello" },
    ];
    const next = [
      { id: "row_1", kind: "user" as const, content: "hello" },
      { id: "row_2", kind: "assistant" as const, content: "hi" },
    ];

    expect(appendPromotedItems(initial, next)).toEqual([
      { id: "header_sess_demo", kind: "header", lines: [] },
      { id: "row_1", kind: "user", content: "hello" },
      { id: "row_2", kind: "assistant", content: "hi" },
    ]);
  });
});
