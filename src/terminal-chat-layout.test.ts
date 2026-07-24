import { describe, expect, test } from "bun:test";
import { wrapCodeText } from "./chat-content";
import { layoutTranscriptTool, wrapSpans } from "./terminal-chat-layout";
import type { TerminalSpan } from "./terminal-scene-contract";
import type { ToolOutputPart } from "./tool-output-contract";

function rowText(row: TerminalSpan[]): string {
  return row.map((span) => span.text).join("");
}

describe("wrapSpans", () => {
  test("keeps a fitting multi-role line as one row with roles intact", () => {
    const spans: TerminalSpan[] = [
      { text: "const", role: "syntax-keyword" },
      { text: " x = ", role: "syntax-plain" },
      { text: "1", role: "syntax-number" },
    ];
    expect(wrapSpans(spans, 80)).toEqual([spans]);
  });

  test("hard-wraps across spans, preserving every character and role at the split", () => {
    const spans: TerminalSpan[] = [
      { text: "abc", role: "syntax-keyword" },
      { text: "defg", role: "syntax-string" },
    ];
    const rows = wrapSpans(spans, 4);
    expect(rows.map(rowText).join("")).toBe("abcdefg");
    // A physical row that straddles the source role boundary keeps both roles in place.
    expect(rows).toEqual([
      [
        { text: "abc", role: "syntax-keyword" },
        { text: "d", role: "syntax-string" },
      ],
      [{ text: "efg", role: "syntax-string" }],
    ]);
  });

  test("yields one empty row for empty input", () => {
    expect(wrapSpans([], 80)).toEqual([[]]);
    expect(wrapSpans([{ text: "", role: "syntax-plain" }], 80)).toEqual([[]]);
  });

  test("measures display width, not length, for wide graphemes", () => {
    const rows = wrapSpans([{ text: "一二三", role: "syntax-plain" }], 4);
    expect(rows.map(rowText)).toEqual(["一二", "三"]);
  });

  // wrapSpans (chat, colored) and wrapCodeText (CLI, colorless) must break at the same columns, or
  // the two surfaces drift. This pins the shared break rule.
  test.each([
    ["const value = computeSomething(input);", 12],
    ["    deeply.indented.chain().call().here()", 8],
    ["tabs\tand  spaces   kept", 7],
    ["一二三四五六七八九十", 5],
    ["short", 80],
    ["", 10],
  ])("matches wrapCodeText geometry for %p @ %p", (text, budget) => {
    const viaSpans = wrapSpans([{ text, role: "syntax-plain" }], budget).map(rowText);
    expect(viaSpans).toEqual(wrapCodeText(text, budget));
  });
});

describe("layoutTranscriptTool diff highlighting", () => {
  const editHeader = (path: string): ToolOutputPart => ({
    kind: "edit-header",
    labelKey: "tool.label.file_edit",
    path,
    added: 1,
    removed: 1,
  });
  const bodyLine = (parts: ToolOutputPart[]) =>
    layoutTranscriptTool({ parts, status: "success", columns: 80 }).lines[1];
  const rolesOf = (spans: TerminalSpan[]) => spans.map((span) => span.role);
  const codeText = (spans: TerminalSpan[]) =>
    spans
      .filter((span) => span.role.startsWith("syntax-"))
      .map((span) => span.text)
      .join("");

  test("syntax-colors an added line, keeping the add band and tinted gutter", () => {
    const line = bodyLine([
      editHeader("src/foo.ts"),
      { kind: "diff", marker: "add", lineNumber: 12, text: "const x = 1;" },
    ]);
    expect(line.fill).toBe("diff-added");
    expect(rolesOf(line.spans)).toEqual(expect.arrayContaining(["syntax-keyword", "tool-meta-add"]));
    expect(codeText(line.spans)).toBe("const x = 1;");
  });

  test("renders a removed line flat red on its band, unhighlighted", () => {
    const line = bodyLine([
      editHeader("src/foo.ts"),
      { kind: "diff", marker: "remove", lineNumber: 9, text: "const x = 1;" },
    ]);
    expect(line.fill).toBe("diff-removed");
    expect(rolesOf(line.spans)).not.toContain("syntax-keyword");
    expect(codeText(line.spans)).toBe("");
    expect(line.spans.some((span) => span.role === "diff-removed" && span.text.includes("const x = 1;"))).toBe(true);
  });

  test("syntax-colors a context line with no band", () => {
    const line = bodyLine([
      editHeader("src/foo.ts"),
      { kind: "diff", marker: "context", lineNumber: 5, text: "return x;" },
    ]);
    expect(line.fill).toBeUndefined();
    expect(rolesOf(line.spans)).toContain("syntax-keyword");
  });

  test("leaves an unknown-extension diff body flat on its band", () => {
    const line = bodyLine([
      editHeader("notes.unknownext"),
      { kind: "diff", marker: "add", lineNumber: 1, text: "const x = 1;" },
    ]);
    const roles = rolesOf(line.spans);
    expect(roles).not.toContain("syntax-keyword");
    expect(roles).toContain("diff-added");
  });
});
