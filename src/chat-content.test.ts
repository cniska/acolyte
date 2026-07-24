import { describe, expect, test } from "bun:test";
import {
  sanitizeAssistantContent,
  segmentAssistantContent,
  wrapAssistantContent,
  wrapCodeText,
  wrapText,
} from "./chat-content";

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

describe("segmentAssistantContent", () => {
  test("returns a single prose segment when there is no fence", () => {
    expect(segmentAssistantContent("just prose\nacross lines")).toEqual([
      { kind: "prose", text: "just prose\nacross lines" },
    ]);
  });

  test("splits prose, code, and trailing prose around a fence", () => {
    expect(segmentAssistantContent("before\n```ts\nconst x = 1\n```\nafter")).toEqual([
      { kind: "prose", text: "before" },
      { kind: "code", lang: "ts", text: "const x = 1", closed: true },
      { kind: "prose", text: "after" },
    ]);
  });

  test("preserves code indentation verbatim", () => {
    const [segment] = segmentAssistantContent("```py\nif cond:\n    do()\n        deeper()\n```");
    expect(segment).toEqual({ kind: "code", lang: "py", text: "if cond:\n    do()\n        deeper()", closed: true });
  });

  test("strips only the opening fence's indentation, keeping relative indent", () => {
    const [segment] = segmentAssistantContent("  ```js\n  const x = 1\n    nested()\n  ```");
    expect(segment).toEqual({ kind: "code", lang: "js", text: "const x = 1\n  nested()", closed: true });
  });

  test("marks an unclosed fence and runs it to the end", () => {
    expect(segmentAssistantContent("text\n```\ncode line\nmore")).toEqual([
      { kind: "prose", text: "text" },
      { kind: "code", lang: "", text: "code line\nmore", closed: false },
    ]);
  });

  test("supports tilde fences", () => {
    expect(segmentAssistantContent("~~~\ncode\n~~~")).toEqual([{ kind: "code", lang: "", text: "code", closed: true }]);
  });

  test("does not close a backtick fence on a tilde line", () => {
    const [segment] = segmentAssistantContent("```\n~~~\nx\n```");
    expect(segment).toEqual({ kind: "code", lang: "", text: "~~~\nx", closed: true });
  });
});

describe("wrapCodeText", () => {
  test("leaves a fitting line as one row", () => {
    expect(wrapCodeText("const x = 1", 80)).toEqual(["const x = 1"]);
  });

  test("hard-wraps at the width budget without dropping characters", () => {
    const rows = wrapCodeText("abcdefghij", 4);
    expect(rows).toEqual(["abcd", "efgh", "ij"]);
    expect(rows.join("")).toBe("abcdefghij");
    for (const row of rows) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(4);
  });

  test("preserves leading whitespace (no word wrap, no trim)", () => {
    expect(wrapCodeText("    indented code", 80)).toEqual(["    indented code"]);
  });

  test("yields one empty row for a blank line", () => {
    expect(wrapCodeText("", 80)).toEqual([""]);
  });

  test("clamps a non-positive budget to one column", () => {
    expect(wrapCodeText("ab", 0)).toEqual(["a", "b"]);
  });
});
