import { describe, expect, test } from "bun:test";
import { resolveHistoryDown, resolveHistoryUp, resolveTabAutocomplete } from "./chat-keybindings";

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
    expect(result).toBe("review @src/chat-ui.tsx");
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
    expect(result).toBe("/status ");
  });
});
