import { describe, expect, test } from "bun:test";
import { processInputChange, processInputSubmit } from "./chat-input-handlers";

describe("chat input handlers", () => {
  test("processInputChange ignores leading question-mark shortcut trigger", () => {
    expect(
      processInputChange({
        currentValue: "",
        nextValue: "?",
        applyingHistory: false,
      }),
    ).toEqual({
      ignore: true,
      clearApplyingHistory: false,
      resetHistoryIndex: false,
      nextValue: "",
    });
  });

  test("processInputChange clears applying-history without resetting history index", () => {
    expect(
      processInputChange({
        currentValue: "hello",
        nextValue: "hello!",
        applyingHistory: true,
      }),
    ).toEqual({
      ignore: false,
      clearApplyingHistory: true,
      resetHistoryIndex: false,
      nextValue: "hello!",
    });
  });

  test("processInputSubmit returns autocomplete decision for slash command", () => {
    expect(
      processInputSubmit({
        value: "/st",
        atSuggestions: [],
        atSuggestionIndex: 0,
        slashSuggestions: ["/status"],
        slashSuggestionIndex: 0,
      }),
    ).toEqual({
      kind: "autocomplete",
      value: "/status ",
    });
  });
});
