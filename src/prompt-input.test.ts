import { describe, expect, test } from "bun:test";
import {
  buildPromptDisplayLines,
  cursorLineIndex,
  moveLineDown,
  moveLineUp,
  moveWordLeft,
  moveWordRight,
} from "./prompt-input";

describe("prompt input word navigation", () => {
  test("moveWordLeft jumps to previous word start", () => {
    const value = "run verify now";
    expect(moveWordLeft(value, value.length)).toBe(11); // now
    expect(moveWordLeft(value, 11)).toBe(4); // verify
    expect(moveWordLeft(value, 4)).toBe(0); // run
  });

  test("moveWordRight jumps to next word end", () => {
    const value = "run verify now";
    expect(moveWordRight(value, 0)).toBe(3);
    expect(moveWordRight(value, 4)).toBe(10);
    expect(moveWordRight(value, 11)).toBe(14);
  });

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
