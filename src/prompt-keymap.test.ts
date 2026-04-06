import { describe, expect, test } from "bun:test";
import { resolvePromptAction } from "./prompt-keymap";
import type { KeyEvent } from "./tui/context";
import { emptyKey } from "./tui/input";

function key(overrides: Partial<KeyEvent>): KeyEvent {
  return { ...emptyKey(), ...overrides };
}

const noMeta = { hasMetaPrefix: false };

describe("prompt keymap", () => {
  test("submit on enter", () => {
    expect(resolvePromptAction("", key({ return: true }), noMeta)).toEqual({ type: "submit" });
  });

  test("insert plain text", () => {
    expect(resolvePromptAction("x", emptyKey(), noMeta)).toEqual({ type: "insert", text: "x" });
  });

  test("shift+enter inserts newline", () => {
    expect(resolvePromptAction("", key({ return: true, shift: true }), noMeta)).toEqual({
      type: "insert",
      text: "\n",
    });
  });

  test("noop for tab, ctrl+c", () => {
    expect(resolvePromptAction("", key({ tab: true }), noMeta)).toEqual({ type: "noop" });
    expect(resolvePromptAction("c", key({ ctrl: true }), noMeta)).toEqual({ type: "noop" });
  });

  test("up/down arrows produce move_up/move_down", () => {
    expect(resolvePromptAction("", key({ upArrow: true }), noMeta)).toEqual({ type: "move_up" });
    expect(resolvePromptAction("", key({ downArrow: true }), noMeta)).toEqual({ type: "move_down" });
  });

  describe("home/end", () => {
    test("home key", () => {
      expect(resolvePromptAction("", key({ home: true }), noMeta)).toEqual({ type: "move_home" });
    });

    test("end key", () => {
      expect(resolvePromptAction("", key({ end: true }), noMeta)).toEqual({ type: "move_end" });
    });

    test("cmd+left → home", () => {
      expect(resolvePromptAction("", key({ super: true, leftArrow: true }), noMeta)).toEqual({ type: "move_home" });
    });

    test("cmd+right → end", () => {
      expect(resolvePromptAction("", key({ super: true, rightArrow: true }), noMeta)).toEqual({ type: "move_end" });
    });

    test("ctrl+a → home", () => {
      expect(resolvePromptAction("a", key({ ctrl: true }), noMeta)).toEqual({ type: "move_home" });
    });

    test("ctrl+e → end", () => {
      expect(resolvePromptAction("e", key({ ctrl: true }), noMeta)).toEqual({ type: "move_end" });
    });
  });

  describe("word navigation", () => {
    test("alt+left → word left", () => {
      expect(resolvePromptAction("", key({ meta: true, leftArrow: true }), noMeta)).toEqual({
        type: "move_word_left",
      });
    });

    test("alt+right → word right", () => {
      expect(resolvePromptAction("", key({ meta: true, rightArrow: true }), noMeta)).toEqual({
        type: "move_word_right",
      });
    });

    test("ctrl+left → word left", () => {
      expect(resolvePromptAction("", key({ ctrl: true, leftArrow: true }), noMeta)).toEqual({
        type: "move_word_left",
      });
    });

    test("ctrl+right → word right", () => {
      expect(resolvePromptAction("", key({ ctrl: true, rightArrow: true }), noMeta)).toEqual({
        type: "move_word_right",
      });
    });

    test("alt+b → word left", () => {
      expect(resolvePromptAction("b", key({ meta: true }), noMeta)).toEqual({ type: "move_word_left" });
    });

    test("alt+f → word right", () => {
      expect(resolvePromptAction("f", key({ meta: true }), noMeta)).toEqual({ type: "move_word_right" });
    });
  });

  describe("deletion", () => {
    test("backspace", () => {
      expect(resolvePromptAction("", key({ backspace: true }), noMeta)).toEqual({ type: "delete_back" });
    });

    test("delete key", () => {
      expect(resolvePromptAction("", key({ delete: true }), noMeta)).toEqual({ type: "delete_forward" });
    });

    test("alt+backspace → delete word back", () => {
      expect(resolvePromptAction("", key({ meta: true, backspace: true }), noMeta)).toEqual({
        type: "delete_word_back",
      });
    });

    test("alt+delete → delete word back", () => {
      expect(resolvePromptAction("", key({ meta: true, delete: true }), noMeta)).toEqual({
        type: "delete_word_back",
      });
    });

    test("ctrl+w → delete word back", () => {
      expect(resolvePromptAction("w", key({ ctrl: true }), noMeta)).toEqual({ type: "delete_word_back" });
    });

    test("meta prefix + backspace → delete word back", () => {
      expect(resolvePromptAction("", key({ backspace: true }), { hasMetaPrefix: true })).toEqual({
        type: "delete_word_back",
      });
    });
  });

  describe("clear line", () => {
    test("ctrl+u", () => {
      expect(resolvePromptAction("u", key({ ctrl: true }), noMeta)).toEqual({ type: "clear_line" });
    });
  });

  describe("simple movement", () => {
    test("left arrow", () => {
      expect(resolvePromptAction("", key({ leftArrow: true }), noMeta)).toEqual({ type: "move_left" });
    });

    test("right arrow", () => {
      expect(resolvePromptAction("", key({ rightArrow: true }), noMeta)).toEqual({ type: "move_right" });
    });
  });
});
