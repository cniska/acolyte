import { describe, expect, test } from "bun:test";
import { consumesMetaPrefix, type PromptAction, resolvePromptAction, resolvePromptEdit } from "./prompt-keymap";
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
    expect(resolvePromptAction("x", emptyKey(), noMeta)).toEqual({ type: "insert", text: "x", paste: false });
  });

  test("insert carries the paste bit", () => {
    expect(resolvePromptAction("x", key({ paste: true }), noMeta)).toEqual({
      type: "insert",
      text: "x",
      paste: true,
    });
  });

  test("shift+enter inserts newline", () => {
    expect(resolvePromptAction("", key({ return: true, shift: true }), noMeta)).toEqual({
      type: "insert",
      text: "\n",
      paste: false,
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

const insert = (text: string, paste = false): PromptAction => ({ type: "insert", text, paste });

describe("resolvePromptEdit", () => {
  describe("suppressed edits", () => {
    test("backspace at the start of the buffer", () => {
      expect(resolvePromptEdit({ type: "delete_back" }, { text: "ab", cursor: 0 })).toEqual({ kind: "none" });
    });

    test("forward delete at the end of the buffer", () => {
      expect(resolvePromptEdit({ type: "delete_forward" }, { text: "ab", cursor: 2 })).toEqual({ kind: "none" });
    });

    test("word deletion at the start of the buffer", () => {
      expect(resolvePromptEdit({ type: "delete_word_back" }, { text: "foo bar", cursor: 0 })).toEqual({ kind: "none" });
    });

    test("clear on an empty buffer", () => {
      expect(resolvePromptEdit({ type: "clear_line" }, { text: "", cursor: 0 })).toEqual({ kind: "none" });
    });

    test("an inert chord", () => {
      expect(resolvePromptEdit({ type: "noop" }, { text: "ab", cursor: 1 })).toEqual({ kind: "none" });
    });
  });

  describe("deletions past their guard", () => {
    test("backspace", () => {
      expect(resolvePromptEdit({ type: "delete_back" }, { text: "ab", cursor: 1 })).toEqual({
        kind: "edit",
        action: { kind: "delete-backward" },
      });
    });

    test("forward delete", () => {
      expect(resolvePromptEdit({ type: "delete_forward" }, { text: "ab", cursor: 1 })).toEqual({
        kind: "edit",
        action: { kind: "delete-forward" },
      });
    });

    test("word deletion", () => {
      expect(resolvePromptEdit({ type: "delete_word_back" }, { text: "foo bar", cursor: 7 })).toEqual({
        kind: "edit",
        action: { kind: "delete-word-backward" },
      });
    });

    test("clear", () => {
      expect(resolvePromptEdit({ type: "clear_line" }, { text: "ab", cursor: 2 })).toEqual({
        kind: "edit",
        action: { kind: "clear" },
      });
    });
  });

  describe("help swallow", () => {
    test("a lone '?' on an empty buffer decides nothing", () => {
      expect(resolvePromptEdit(insert("?"), { text: "", cursor: 0 })).toEqual({ kind: "none" });
    });

    test("'?' inserts once the buffer is non-empty", () => {
      expect(resolvePromptEdit(insert("?"), { text: "a", cursor: 1 })).toEqual({
        kind: "edit",
        action: { kind: "insert", text: "?" },
      });
    });

    test("a pasted '?' on an empty buffer inserts", () => {
      expect(resolvePromptEdit(insert("?", true), { text: "", cursor: 0 })).toEqual({
        kind: "edit",
        action: { kind: "insert", text: "?" },
      });
    });
  });

  describe("movement", () => {
    test("horizontal and bound moves map onto move actions", () => {
      const state = { text: "foo bar", cursor: 3 };
      expect(resolvePromptEdit({ type: "move_left" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move", direction: "left" },
      });
      expect(resolvePromptEdit({ type: "move_right" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move", direction: "right" },
      });
      expect(resolvePromptEdit({ type: "move_home" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move", direction: "home" },
      });
      expect(resolvePromptEdit({ type: "move_end" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move", direction: "end" },
      });
    });

    test("word moves map onto move-word actions", () => {
      const state = { text: "foo bar", cursor: 3 };
      expect(resolvePromptEdit({ type: "move_word_left" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move-word", direction: "left" },
      });
      expect(resolvePromptEdit({ type: "move_word_right" }, state)).toEqual({
        kind: "edit",
        action: { kind: "move-word", direction: "right" },
      });
    });

    test("vertical moves resolve to an absolute cursor through the wrapped layout", () => {
      // "aaa bbb ccc" at width 5 soft-wraps to rows ["aaa ", "bbb ", "ccc"].
      const up = resolvePromptEdit({ type: "move_up" }, { text: "aaa bbb ccc", cursor: 11 }, 5);
      expect(up.kind).toBe("edit");
      expect(up).toEqual({ kind: "edit", action: { kind: "set-cursor", cursor: 7 } });
      const down = resolvePromptEdit({ type: "move_down" }, { text: "hello\nworld", cursor: 0 });
      expect(down).toEqual({ kind: "edit", action: { kind: "set-cursor", cursor: 6 } });
    });

    test("an unwrapped vertical move ignores the wrapped geometry", () => {
      expect(resolvePromptEdit({ type: "move_up" }, { text: "aaa bbb ccc", cursor: 11 })).toEqual({
        kind: "edit",
        action: { kind: "set-cursor", cursor: 11 },
      });
    });
  });

  test("submit carries no edit", () => {
    expect(resolvePromptEdit({ type: "submit" }, { text: "ship it", cursor: 7 })).toEqual({ kind: "submit" });
  });
});

describe("consumesMetaPrefix", () => {
  test("edits and inert chords consume the prefix", () => {
    expect(consumesMetaPrefix({ type: "noop" })).toBe(true);
    expect(consumesMetaPrefix(insert("x"))).toBe(true);
    expect(consumesMetaPrefix({ type: "delete_back" })).toBe(true);
    expect(consumesMetaPrefix({ type: "delete_forward" })).toBe(true);
    expect(consumesMetaPrefix({ type: "delete_word_back" })).toBe(true);
    expect(consumesMetaPrefix({ type: "clear_line" })).toBe(true);
  });

  test("moves and submit leave the prefix armed", () => {
    expect(consumesMetaPrefix({ type: "submit" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_left" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_right" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_home" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_end" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_word_left" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_word_right" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_up" })).toBe(false);
    expect(consumesMetaPrefix({ type: "move_down" })).toBe(false);
  });
});
