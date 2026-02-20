import { describe, expect, test } from "bun:test";
import { resolveSubmitInput } from "./chat-submit";

describe("chat submit helpers", () => {
  test("autocompletes unresolved @path on submit", () => {
    const result = resolveSubmitInput({
      value: "review @src/ch",
      atSuggestions: ["src/chat-ui.tsx"],
      atSuggestionIndex: 0,
      slashSuggestions: [],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "autocomplete", value: "review @src/chat-ui.tsx" });
  });

  test("autocompletes unresolved slash command on submit", () => {
    const result = resolveSubmitInput({
      value: "/st",
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: ["/status"],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "autocomplete", value: "/status " });
  });

  test("submits when no autocomplete rule applies", () => {
    const result = resolveSubmitInput({
      value: "hello world",
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: [],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "submit", value: "hello world" });
  });
});
