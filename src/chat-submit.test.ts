import { describe, expect, test } from "bun:test";
import { resolveQueueSubmit, resolveSubmitInput } from "./chat-submit";

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

  test("resolveQueueSubmit ignores empty input", () => {
    expect(resolveQueueSubmit({ value: "   ", isWorking: true })).toEqual({ kind: "ignore" });
  });

  test("resolveQueueSubmit submits while thinking", () => {
    expect(resolveQueueSubmit({ value: "hello", isWorking: true })).toEqual({
      kind: "submit",
      value: "hello",
    });
  });

  test("resolveQueueSubmit submits slash commands while thinking", () => {
    expect(resolveQueueSubmit({ value: "/status", isWorking: true })).toEqual({
      kind: "submit",
      value: "/status",
    });
  });

  test("resolveQueueSubmit submits immediately when idle", () => {
    expect(resolveQueueSubmit({ value: "hello", isWorking: false })).toEqual({
      kind: "submit",
      value: "hello",
    });
  });
});
