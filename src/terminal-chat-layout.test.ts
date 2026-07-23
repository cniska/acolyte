import { describe, expect, test } from "bun:test";
import { wrapCodeText } from "./chat-content";
import { wrapSpans } from "./terminal-chat-layout";
import type { TerminalSpan } from "./terminal-scene-contract";

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
