import { describe, expect, test } from "bun:test";
import { highlightCode } from "./code-highlight";
import type { TerminalSpan } from "./terminal-scene-contract";

function reconstruct(lines: TerminalSpan[][]): string {
  return lines.map((line) => line.map((span) => span.text).join("")).join("\n");
}
function spans(lines: TerminalSpan[][]): TerminalSpan[] {
  return lines.flat();
}

describe("highlightCode", () => {
  test("tokenizes into bounded syntax roles", () => {
    const flat = spans(highlightCode('const x = 1; // note\nconst s = "hi";', "ts"));
    expect(flat).toContainEqual({ text: "const", role: "syntax-keyword" });
    expect(flat).toContainEqual({ text: "1", role: "syntax-number" });
    expect(flat).toContainEqual({ text: "// note", role: "syntax-comment" });
    expect(flat).toContainEqual({ text: '"hi"', role: "syntax-string" });
  });

  test("maps decorators to the brand meta role", () => {
    const flat = spans(highlightCode("@Component()\nclass A {}", "ts"));
    expect(flat).toContainEqual({ text: "@Component", role: "syntax-meta" });
  });

  // The upgrade tripwire: token text must reconstruct the source byte-for-byte, or a highlight.js /
  // lowlight bump silently rewrote token boundaries.
  test.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture is TS source with a template literal
    ["typescript", "export const n: number = 42;\nfunction f() {\n  return `t${n}`;\n}"],
    ["python", 'def f(x: int) -> int:\n    """doc"""\n    return x + 1  # c'],
    ["json", '{\n  "a": 1,\n  "b": [true, null]\n}'],
    ["bash", 'set -e\nfor f in *.ts; do\n  echo "$f"\ndone'],
    ["css", ".a {\n  color: #fff;\n  margin: 0 auto;\n}"],
    ["yaml", "name: acolyte\nlist:\n  - one\n  - two"],
  ])("reconstructs %s source losslessly", (lang, source) => {
    expect(reconstruct(highlightCode(source, lang))).toBe(source);
  });

  test("splits a multi-line block comment into per-line spans", () => {
    const lines = highlightCode("/*\n a\n b\n*/\nx", "ts");
    expect(lines).toHaveLength(5);
    for (const line of lines.slice(0, 4)) {
      for (const span of line) expect(span.role).toBe("syntax-comment");
    }
    expect(reconstruct(lines)).toBe("/*\n a\n b\n*/\nx");
  });

  test("resolves aliases and preserves blank lines", () => {
    const alias = spans(highlightCode("def f(): pass", "python"));
    expect(alias).toContainEqual({ text: "def", role: "syntax-keyword" });
    const withBlank = highlightCode("a = 1\n\nb = 2", "py");
    expect(withBlank[1]).toEqual([]);
  });

  test("renders unknown languages as plain, line-split", () => {
    const lines = highlightCode("const x = 1\nlet y = 2", "no-such-lang");
    expect(lines).toEqual([
      [{ text: "const x = 1", role: "syntax-plain" }],
      [{ text: "let y = 2", role: "syntax-plain" }],
    ]);
  });

  test("falls back to plain above the size ceiling", () => {
    const huge = Array.from({ length: 401 }, () => "const x = 1").join("\n");
    const flat = spans(highlightCode(huge, "ts"));
    expect(flat.every((span) => span.role === "syntax-plain")).toBe(true);
    expect(flat.some((span) => span.role === "syntax-keyword")).toBe(false);
  });
});
