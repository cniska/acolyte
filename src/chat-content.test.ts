import { describe, expect, test } from "bun:test";
import { sanitizeAssistantContent, wrapAssistantContent, wrapText } from "./chat-content";

describe("chat-content helpers", () => {
  test("sanitizeAssistantContent left-aligns numbered findings", () => {
    const raw = ["  1. First finding", "    2. Second finding"].join("\n");
    expect(sanitizeAssistantContent(raw)).toBe(["1. First finding", "2. Second finding"].join("\n"));
  });

  test("wrapText wraps long lines at word boundaries", () => {
    const text = "one two three four five six seven eight nine ten";
    const wrapped = wrapText(text, 30);
    const lines = wrapped.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  test("wrapText preserves explicit newlines", () => {
    const wrapped = wrapText("first line\nsecond line", 80);
    expect(wrapped).toBe("first line\nsecond line");
  });

  test("wrapText leaves short lines unchanged", () => {
    expect(wrapText("hello", 80)).toBe("hello");
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
