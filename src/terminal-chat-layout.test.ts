import { describe, expect, test } from "bun:test";
import { layoutComposer, truncateTerminalText, wrapTerminalText } from "./terminal-chat-layout";

describe("terminal chat layout", () => {
  test("wraps on grapheme and display-cell boundaries", () =>
    expect(wrapTerminalText("a日本語b", 4)).toEqual(["a日", "本語", "b"]));
  test("truncates with an ellipsis without splitting a grapheme", () =>
    expect(truncateTerminalText("日本語", 5)).toBe("日本…"));
  test("aligns composer continuations and maps the logical cursor", () => {
    const result = layoutComposer({ text: "one two", cursor: 7 }, { columns: 12, rows: 20 });
    expect(result.lines[2]?.spans[1]?.text).toBe("  ");
    expect(result.cursor).toEqual({ row: 2, column: 5 });
  });
});
