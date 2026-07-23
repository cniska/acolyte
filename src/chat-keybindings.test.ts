import { describe, expect, test } from "bun:test";
import {
  resolveBareCharShortcut,
  resolveEscapeAction,
  resolveHistoryDown,
  resolveHistoryUp,
  resolveTabAutocomplete,
  shouldCycleInputHistory,
} from "./chat-keybindings";

describe("chat keybindings helpers", () => {
  test("resolveHistoryUp starts browsing from latest entry and saves draft", () => {
    expect(resolveHistoryUp(["first", "second"], -1, "draft")).toEqual({
      nextIndex: 1,
      nextValue: "second",
      nextDraft: "draft",
    });
  });

  test("resolveHistoryDown exits browsing mode when reaching latest entry", () => {
    expect(resolveHistoryDown(["first", "second"], 1, "draft")).toEqual({
      nextIndex: -1,
      nextValue: "draft",
    });
  });

  test("resolveTabAutocomplete applies @ suggestion when eligible", () => {
    const result = resolveTabAutocomplete({
      browsingInputHistory: false,
      value: "review @src/ch",
      atQuery: "src/ch",
      atSuggestions: ["src/chat-ui.tsx"],
      atSuggestionIndex: 0,
      slashSuggestions: [],
      slashSuggestionIndex: 0,
      isTab: true,
    });
    expect(result).toBe("review @src/chat-ui.tsx ");
  });

  test("resolveTabAutocomplete applies slash suggestion when eligible", () => {
    const result = resolveTabAutocomplete({
      browsingInputHistory: false,
      value: "/st",
      atQuery: null,
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: ["/status"],
      slashSuggestionIndex: 0,
      isTab: true,
    });
    expect(result).toBe("/status");
  });

  test("ghost-accept (right arrow) applies a prefix suggestion", () => {
    const result = resolveTabAutocomplete({
      browsingInputHistory: false,
      value: "/st",
      atQuery: null,
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: ["/status"],
      slashSuggestionIndex: 0,
      isTab: false,
      isGhostAccept: true,
    });
    expect(result).toBe("/status");
  });

  test("ghost-accept ignores a fuzzy (non-prefix) suggestion, though tab still takes it", () => {
    const shared = {
      browsingInputHistory: false,
      value: "/hepl",
      atQuery: null,
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: ["/help"],
      slashSuggestionIndex: 0,
    };
    // `/help` is not a prefix extension of `/hepl`, so the ghost never showed → right arrow no-ops.
    expect(resolveTabAutocomplete({ ...shared, isTab: false, isGhostAccept: true })).toBeNull();
    // Tab still accepts the selected candidate from the list.
    expect(resolveTabAutocomplete({ ...shared, isTab: true })).toBe("/help");
  });

  test("resolveBareCharShortcut ignores pasted ? and $ so they insert as text", () => {
    // Regression: pasting text ending in "?" popped the help panel.
    expect(resolveBareCharShortcut({ keyInput: "?", paste: true, valueLength: 0, isPending: false })).toBeNull();
    expect(resolveBareCharShortcut({ keyInput: "$", paste: true, valueLength: 0, isPending: false })).toBeNull();
  });

  test("resolveBareCharShortcut fires only on a genuine keystroke on an empty field", () => {
    expect(resolveBareCharShortcut({ keyInput: "?", paste: false, valueLength: 0, isPending: false })).toBe("help");
    expect(resolveBareCharShortcut({ keyInput: "$", paste: false, valueLength: 0, isPending: false })).toBe("skills");
    // non-empty field: a real char in the text, not a shortcut
    expect(resolveBareCharShortcut({ keyInput: "?", paste: false, valueLength: 3, isPending: false })).toBeNull();
    // help works while pending; skills does not
    expect(resolveBareCharShortcut({ keyInput: "?", paste: false, valueLength: 0, isPending: true })).toBe("help");
    expect(resolveBareCharShortcut({ keyInput: "$", paste: false, valueLength: 0, isPending: true })).toBeNull();
  });

  test("resolveEscapeAction prefers interrupt while thinking", () => {
    expect(resolveEscapeAction({ isPending: true, showHelp: true })).toBe("interrupt");
    expect(resolveEscapeAction({ isPending: false, showHelp: true })).toBe("hide");
    expect(resolveEscapeAction({ isPending: false, showHelp: false })).toBeNull();
  });

  test("shouldCycleInputHistory allows browsing from any index", () => {
    expect(shouldCycleInputHistory(-1)).toBeTrue();
    expect(shouldCycleInputHistory(0)).toBeTrue();
  });
});
