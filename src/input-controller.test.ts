import { describe, expect, test } from "bun:test";
import { createInputController, reduceInput } from "./input-controller";

describe("input controller", () => {
  test("owns logical text and cursor independently of rendering", () => {
    let state = createInputController("ac");
    state = reduceInput(state, { kind: "move", direction: "left" });
    state = reduceInput(state, { kind: "insert", text: "b" });
    expect(state).toEqual({ text: "abc", cursor: 2 });
  });
  test("clamps replacement cursors and preserves boundaries", () => {
    expect(reduceInput(createInputController(), { kind: "replace", text: "x", cursor: 9 })).toEqual({
      text: "x",
      cursor: 1,
    });
    expect(reduceInput(createInputController(), { kind: "delete-backward" })).toEqual({ text: "", cursor: 0 });
  });
  test("replace without a cursor lands at the end of the new text", () => {
    expect(reduceInput({ text: "/he", cursor: 3 }, { kind: "replace", text: "/new" })).toEqual({
      text: "/new",
      cursor: 4,
    });
    expect(reduceInput({ text: "longer text", cursor: 9 }, { kind: "replace", text: "hi" })).toEqual({
      text: "hi",
      cursor: 2,
    });
  });
  test("moves by word boundary in both directions", () => {
    expect(reduceInput({ text: "one two", cursor: 7 }, { kind: "move-word", direction: "left" })).toEqual({
      text: "one two",
      cursor: 4,
    });
    expect(reduceInput({ text: "one two", cursor: 0 }, { kind: "move-word", direction: "right" })).toEqual({
      text: "one two",
      cursor: 3,
    });
  });
  test("moves by word boundary across successive words", () => {
    const text = "run verify now";
    const left = (cursor: number) => reduceInput({ text, cursor }, { kind: "move-word", direction: "left" }).cursor;
    expect([left(text.length), left(11), left(4)]).toEqual([11, 4, 0]);
    const right = (cursor: number) => reduceInput({ text, cursor }, { kind: "move-word", direction: "right" }).cursor;
    expect([right(0), right(4), right(11)]).toEqual([3, 10, 14]);
  });
  test("deletes the word before the cursor", () => {
    expect(reduceInput({ text: "one two", cursor: 7 }, { kind: "delete-word-backward" })).toEqual({
      text: "one ",
      cursor: 4,
    });
    expect(reduceInput({ text: "one two", cursor: 0 }, { kind: "delete-word-backward" })).toEqual({
      text: "one two",
      cursor: 0,
    });
  });
  test("clears all text and resets the cursor", () =>
    expect(reduceInput({ text: "abc", cursor: 3 }, { kind: "clear" })).toEqual({ text: "", cursor: 0 }));
  test("sets an absolute cursor clamped to text length", () => {
    expect(reduceInput({ text: "abc", cursor: 0 }, { kind: "set-cursor", cursor: 2 })).toEqual({
      text: "abc",
      cursor: 2,
    });
    expect(reduceInput({ text: "abc", cursor: 0 }, { kind: "set-cursor", cursor: 9 })).toEqual({
      text: "abc",
      cursor: 3,
    });
  });
});
