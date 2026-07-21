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
});
