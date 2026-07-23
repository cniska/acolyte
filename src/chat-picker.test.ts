import { expect, test } from "bun:test";
import { type ModelPickerState, reduceModelPickerAction } from "./chat-picker";

const base: ModelPickerState = {
  kind: "model",
  items: [
    { label: "gpt-5.2", value: "gpt-5.2" },
    { label: "claude-sonnet-5", value: "claude-sonnet-5" },
  ],
  filtered: [
    { label: "gpt-5.2", value: "gpt-5.2" },
    { label: "claude-sonnet-5", value: "claude-sonnet-5" },
  ],
  input: { text: "", cursor: 0 },
  index: 1,
  scrollOffset: 0,
};

test("cursor-only actions keep the picker selection", () => {
  // Arrow keys move the selection via the keybindings but also reach the query input as
  // cursor motion; that motion must not snap the selection back to the top.
  const next = reduceModelPickerAction(base, { kind: "set-cursor", cursor: 0 });
  expect(next.index).toBe(1);
  expect(next.scrollOffset).toBe(0);
});

test("query edits re-filter and reset the selection", () => {
  const next = reduceModelPickerAction(base, { kind: "insert", text: "gpt" });
  expect(next.index).toBe(0);
  expect(next.filtered.map((item) => item.value)).toEqual(["gpt-5.2"]);
});
