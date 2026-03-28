import { describe, expect, test } from "bun:test";
import { sanitizeAssistantContent, tokenizeForHighlighting, wrapAssistantContent } from "./chat-content";

describe("chat-content helpers", () => {
  test("sanitizeAssistantContent removes tools/evidence footer lines", () => {
    const raw = ["Run bun run verify", "", "Tools used: shell-run", "Evidence: src/cli.ts"].join("\n");
    expect(sanitizeAssistantContent(raw)).toBe("Run bun run verify");
  });

  test("sanitizeAssistantContent left-aligns numbered findings", () => {
    const raw = ["  1. First finding", "    2. Second finding"].join("\n");
    expect(sanitizeAssistantContent(raw)).toBe(["1. First finding", "2. Second finding"].join("\n"));
  });

  test("sanitizeAssistantContent returns empty when everything is stripped", () => {
    const raw = ["Tools used: file-search", "Evidence: src/cli.ts:1"].join("\n");
    expect(sanitizeAssistantContent(raw)).toBe("");
  });

  test("tokenizeForHighlighting tags code and paths", () => {
    const tokens = tokenizeForHighlighting("bun run verify in `src/chat-ui.tsx:42` and src/chat-ui.tsx:42");
    const kinds = tokens.map((token) => token.kind);
    expect(kinds).toContain("code");
    expect(kinds).toContain("path");
    expect(kinds).not.toContain("command");
  });

  test("wrapAssistantContent uses hanging indent for numbered items", () => {
    const wrapped = wrapAssistantContent("1. hello world next line here and so on", 16);
    const lines = wrapped.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("1. ")).toBe(true);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("   ")).toBe(true);
    }
  });
});
