import { describe, expect, test } from "bun:test";
import {
  resolveEscapeAction,
  resolveHistoryDown,
  resolveHistoryUp,
  resolveTabAutocomplete,
  shouldCycleInputHistory,
  shouldToggleHelp,
} from "./chat-keybindings";
import { resolvePromptEdit } from "./prompt-keymap";

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

  test("shouldToggleHelp ignores a pasted ? so it inserts as text", () => {
    // Regression: pasting text ending in "?" popped the help panel.
    expect(shouldToggleHelp({ keyInput: "?", paste: true, valueLength: 0 })).toBeFalse();
  });

  test("shouldToggleHelp fires only on a genuine keystroke on an empty field", () => {
    expect(shouldToggleHelp({ keyInput: "?", paste: false, valueLength: 0 })).toBeTrue();
    // non-empty field: a real char in the text, not a shortcut
    expect(shouldToggleHelp({ keyInput: "?", paste: false, valueLength: 3 })).toBeFalse();
  });

  test("a typed $ is not a shortcut", () => {
    // Regression: "$" opened the skills picker and left a stray character behind.
    expect(shouldToggleHelp({ keyInput: "$", paste: false, valueLength: 0 })).toBeFalse();
  });

  test("a bare character is claimed by the shortcut rule or the composer, never both", () => {
    for (const keyInput of ["?", "$", "/", "@", "a"]) {
      const shortcut = shouldToggleHelp({ keyInput, paste: false, valueLength: 0 });
      const decision = resolvePromptEdit({ type: "insert", text: keyInput, paste: false }, { text: "", cursor: 0 });
      expect(shortcut).toBe(decision.kind === "none");
    }
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
