import { describe, expect, test } from "bun:test";
import {
  buildPromptDisplayLines,
  cursorLineIndex,
  moveLineDown,
  moveLineUp,
  promptDisplayRows,
  softWrapLine,
} from "./prompt-display";

describe("prompt input word navigation", () => {
  test("buildPromptDisplayLines resolves cursor on multiline input", () => {
    const lines = buildPromptDisplayLines("a\nbc\ndef", 6);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ before: "a", cursor: null, after: "" });
    expect(lines[1]).toEqual({ before: "bc", cursor: null, after: "" });
    expect(lines[2]).toEqual({ before: "d", cursor: "e", after: "f" });
  });

  test("buildPromptDisplayLines places cursor on trailing empty line", () => {
    const value = "one\ntwo\n";
    const lines = buildPromptDisplayLines(value, value.length);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ before: "", cursor: " ", after: "" });
  });
});

describe("cursorLineIndex", () => {
  test("returns 0 for single-line input", () => {
    expect(cursorLineIndex("hello", 3)).toBe(0);
  });

  test("returns correct line for multi-line input", () => {
    expect(cursorLineIndex("ab\ncd\nef", 0)).toBe(0);
    expect(cursorLineIndex("ab\ncd\nef", 3)).toBe(1);
    expect(cursorLineIndex("ab\ncd\nef", 6)).toBe(2);
  });
});

describe("moveLineUp", () => {
  test("stays on first line", () => {
    expect(moveLineUp("hello", 3)).toBe(3);
  });

  test("moves to previous line preserving column", () => {
    expect(moveLineUp("abc\ndef", 5)).toBe(1); // col 1 on line 1 → col 1 on line 0
  });

  test("clamps column to shorter line", () => {
    expect(moveLineUp("ab\ndefgh", 8)).toBe(2); // col 4 on line 1 → col 2 (end of line 0)
  });
});

describe("moveLineDown", () => {
  test("stays on last line", () => {
    expect(moveLineDown("hello", 3)).toBe(3);
  });

  test("moves to next line preserving column", () => {
    expect(moveLineDown("abc\ndef", 1)).toBe(5); // col 1 on line 0 → col 1 on line 1
  });

  test("clamps column to shorter line", () => {
    expect(moveLineDown("abcde\nfg", 4)).toBe(8); // col 4 on line 0 → col 2 (end of line 1)
  });
});

describe("buildPromptDisplayLines with wrapWidth", () => {
  test("wraps long line into multiple display lines", () => {
    const lines = buildPromptDisplayLines("aaa bbb ccc ddd", 0, 8);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.cursor).not.toBeNull(); // cursor on first display line
  });

  test("cursor on second wrapped segment", () => {
    // "aaa bbb ccc" with wrap at 8 → ["aaa bbb", "ccc"]
    // cursor at offset 8 (start of "ccc") should be on second display line
    const lines = buildPromptDisplayLines("aaa bbb ccc", 8, 8);
    expect(lines.length).toBe(2);
    expect(lines[1]?.cursor).not.toBeNull();
  });
});

describe("moveLineUp/Down with wrapWidth", () => {
  test("moves up across wrapped segments", () => {
    // "aaa bbb ccc ddd" wraps at 8 → ["aaa bbb", "ccc ddd"]
    // cursor at offset 10 (col 2 of "ccc ddd") → should move to offset 2 (col 2 of "aaa bbb")
    const result = moveLineUp("aaa bbb ccc ddd", 10, 8);
    expect(result).toBe(2);
  });

  test("stays on first visual line when wrapping", () => {
    const result = moveLineUp("aaa bbb ccc ddd", 2, 8);
    expect(result).toBe(2);
  });

  test("moves down across wrapped segments", () => {
    const result = moveLineDown("aaa bbb ccc ddd", 2, 8);
    expect(result).toBe(10);
  });
});

describe("softWrapLine", () => {
  const cases: Array<[string, string, number]> = [
    ["a run no row can hold", "a".repeat(120), 112],
    ["an over-long run mid-line", `see https://example.com/${"x".repeat(100)} end`, 112],
    ["a wrap that falls on a space run", "word ".repeat(30).trim(), 112],
    ["runs of spaces only", " ".repeat(30), 8],
    ["a line ending in spaces", `${"word ".repeat(4)}     `, 12],
  ];

  for (const [label, line, width] of cases) {
    test(`tiles the line and holds the width: ${label}`, () => {
      const rows = softWrapLine(line, width);
      expect(rows.join("")).toBe(line);
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(width);
    });
  }

  test("breaks a run that exceeds the width instead of overflowing the row", () => {
    expect(softWrapLine("a".repeat(20), 8)).toEqual(["aaaaaaaa", "aaaaaaaa", "aaaa"]);
  });

  test("keeps a word whole when it fits on the next row", () => {
    expect(softWrapLine("aaa bbbbbb", 8)).toEqual(["aaa ", "bbbbbb"]);
  });
});

describe("promptDisplayRows", () => {
  test("every row's text is the value's own slice at its offset", () => {
    const value = `${"word ".repeat(30).trim()}\n${"b".repeat(200)}\n`;
    for (const row of promptDisplayRows(value, 112)) {
      expect(value.slice(row.startOffset, row.startOffset + row.text.length)).toBe(row.text);
    }
  });
});

describe("wrapped rows the composer cannot scroll sideways", () => {
  const long = "a".repeat(120);

  test("a run wider than the row reports the row the cursor is really on", () => {
    expect(cursorLineIndex(long, 120, 112)).toBe(1);
    expect(cursorLineIndex(long, 0, 112)).toBe(0);
  });

  test("vertical motion crosses a hard-broken run", () => {
    expect(moveLineDown(long, 0, 112)).toBe(112);
    expect(moveLineUp(long, 115, 112)).toBe(3);
  });
});

describe("cursor on a wrap boundary", () => {
  const value = "word ".repeat(30).trim();
  const boundary = promptDisplayRows(value, 112)[0]?.text.length ?? 0;

  test("moving up from the first column of a wrapped row lands on the row above", () => {
    expect(moveLineUp(value, boundary, 112)).toBe(0);
  });

  test("moving down and back up returns to where it started", () => {
    const down = moveLineDown(value, 0, 112);
    expect(down).toBe(boundary);
    expect(moveLineUp(value, down, 112)).toBe(0);
  });
});

describe("wide characters and grapheme clusters", () => {
  test("a run of double-width characters wraps on cells, not code units", () => {
    const line = "漢字".repeat(40);
    const rows = softWrapLine(line, 20);
    expect(rows.join("")).toBe(line);
    for (const row of rows) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(20);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("a multi-codepoint emoji is never split across rows", () => {
    const family = "👨‍👩‍👧‍👦";
    const line = family.repeat(10);
    const rows = softWrapLine(line, 8);
    expect(rows.join("")).toBe(line);
    for (const row of rows) {
      expect(Bun.stringWidth(row)).toBeLessThanOrEqual(8);
      expect(row.length % family.length).toBe(0);
    }
  });

  test("vertical motion holds the visual column across a double-width row", () => {
    // "漢字" is 4 cells wide but 2 code units, so column 4 lands on the fifth character below.
    expect(moveLineDown("漢字漢字\nabcdefgh", 2)).toBe(9);
    expect(moveLineUp("漢字漢字\nabcdefgh", 9)).toBe(2);
  });
});
