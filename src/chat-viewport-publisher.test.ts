import { expect, test } from "bun:test";
import { createViewportPickerInput, createViewportSuggestionsInput } from "./chat-viewport-publisher";
import { createSession } from "./test-utils";

test("viewport picker preserves model input, loading, and filtered values", () => {
  expect(
    createViewportPickerInput(
      {
        kind: "model",
        items: [],
        filtered: [{ label: "GPT", value: "openai/gpt" }],
        input: { text: "gp", cursor: 1 },
        index: 0,
        scrollOffset: 0,
        loading: true,
      },
      "sess_1",
    ),
  ).toEqual({
    kind: "model",
    items: [{ label: "GPT", value: "openai/gpt" }],
    input: { text: "gp", cursor: 1 },
    selected: 0,
    scrollOffset: 0,
    loading: true,
  });
});

test("viewport picker preserves skill metadata and resume identity", () => {
  expect(
    createViewportPickerInput(
      {
        kind: "skills",
        items: [{ name: "build", description: "Implement", path: "/skills/build", source: "project" }],
        index: 0,
      },
      "sess_1",
    ),
  ).toEqual({
    kind: "skills",
    items: [{ name: "build", description: "Implement", path: "/skills/build", source: "project" }],
    selected: 0,
  });
  expect(
    createViewportPickerInput(
      {
        kind: "resume",
        items: [createSession({ id: "sess_2", title: "Previous", updatedAt: "2026-07-21T00:00:00.000Z" })],
        index: 0,
        scrollOffset: 0,
      },
      "sess_1",
    ),
  ).toEqual({
    kind: "sessions",
    items: [{ id: "sess_2", title: "Previous", updatedAt: "2026-07-21T00:00:00.000Z" }],
    selected: 0,
    scrollOffset: 0,
    activeSessionId: "sess_1",
  });
});

test("viewport suggestions retain the active source order", () => {
  expect(
    createViewportSuggestionsInput({
      atQuery: "src",
      atSuggestions: ["src/a.ts"],
      atSuggestionIndex: 0,
      slashSuggestions: ["/status"],
      slashSuggestionIndex: 0,
    }),
  ).toEqual({ kind: "at", query: "src", candidates: ["src/a.ts"], selected: 0 });
});
