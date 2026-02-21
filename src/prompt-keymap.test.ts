import { describe, expect, test } from "bun:test";
import { resolvePromptAction } from "./prompt-keymap";

describe("prompt keymap", () => {
  test("maps submit and plain insert", () => {
    expect(resolvePromptAction("", { return: true }, { hasMetaPrefix: false })).toEqual({ type: "submit" });
    expect(resolvePromptAction("x", {}, { hasMetaPrefix: false })).toEqual({ type: "insert", text: "x" });
  });

  test("maps common word navigation and deletion sequences", () => {
    expect(resolvePromptAction("\u001bb", {}, { hasMetaPrefix: false })).toEqual({ type: "move_word_left" });
    expect(resolvePromptAction("\u001bf", {}, { hasMetaPrefix: false })).toEqual({ type: "move_word_right" });
    expect(resolvePromptAction("\u001b\u007f", {}, { hasMetaPrefix: false })).toEqual({ type: "delete_word_back" });
  });

  test("maps line home/end style sequences often used by cmd+arrows", () => {
    expect(resolvePromptAction("\u001b[1;9D", {}, { hasMetaPrefix: false })).toEqual({ type: "move_home" });
    expect(resolvePromptAction("\u001b[1;9C", {}, { hasMetaPrefix: false })).toEqual({ type: "move_end" });
    expect(resolvePromptAction("\u001b[1;10D", {}, { hasMetaPrefix: false })).toEqual({ type: "move_home" });
    expect(resolvePromptAction("\u001b[1;10C", {}, { hasMetaPrefix: false })).toEqual({ type: "move_end" });
    expect(resolvePromptAction("\u001b[1;13D", {}, { hasMetaPrefix: false })).toEqual({ type: "move_home" });
    expect(resolvePromptAction("\u001b[1;13C", {}, { hasMetaPrefix: false })).toEqual({ type: "move_end" });
  });

  test("maps modifier CSI arrows for word navigation across terminal variants", () => {
    expect(resolvePromptAction("\u001b[1;6D", {}, { hasMetaPrefix: false })).toEqual({ type: "move_word_left" });
    expect(resolvePromptAction("\u001b[1;6C", {}, { hasMetaPrefix: false })).toEqual({ type: "move_word_right" });
  });

  test("maps clear-line control sequence", () => {
    expect(resolvePromptAction("\u0015", {}, { hasMetaPrefix: false })).toEqual({ type: "clear_line" });
    expect(resolvePromptAction("u", { ctrl: true }, { hasMetaPrefix: false })).toEqual({ type: "clear_line" });
  });
});
