import { describe, expect, test } from "bun:test";
import { buildPromptDisplayLines, moveWordLeft, moveWordRight } from "./prompt-input";

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
