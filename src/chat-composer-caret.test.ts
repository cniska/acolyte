import { expect, test } from "bun:test";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutComposerStatus } from "./terminal-chat-layout";
import type { TerminalScene } from "./terminal-scene-contract";
import { terminalTheme } from "./terminal-theme";

const footer = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  model: "gpt-5",
  effort: null,
  inputTokens: 0,
  outputTokens: 0,
  pr: null,
  skills: [],
} as const;

function composerScene(text: string, cursor: number, columns = 80): TerminalScene {
  const composer = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "s" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text, cursor },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  }).composer;
  return layoutComposerStatus({ presentation: composer, constraints: { columns, rows: 40 } });
}

function caretSpans(scene: TerminalScene): { text: string; role: string }[] {
  return scene.lines.flatMap((line) => line.spans.filter((span) => span.role === "cursor"));
}

test("the cursor style role is inverse", () => {
  expect(terminalTheme.styles.cursor.inverse).toBe(true);
});

test("empty input renders the caret on the placeholder first character", () => {
  const carets = caretSpans(composerScene("", 0));
  expect(carets).toHaveLength(1);
  expect(carets[0]?.text.length).toBe(1);
});

test("mid-text cursor renders the caret on the character under it", () => {
  const carets = caretSpans(composerScene("hello", 2));
  expect(carets).toEqual([{ text: "l", role: "cursor" }]);
});

test("cursor at end of input renders a trailing caret space", () => {
  const carets = caretSpans(composerScene("hi", 2));
  expect(carets).toEqual([{ text: " ", role: "cursor" }]);
});

test("a hidden caret renders the character without the cursor role", () => {
  const composer = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "s" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "hi", cursor: 1 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  }).composer;
  const scene = layoutComposerStatus({
    presentation: { ...composer, caretVisible: false },
    constraints: { columns: 80, rows: 40 },
  });
  expect(caretSpans(scene)).toHaveLength(0);
});

test("model picker query renders a caret via the cursor role", () => {
  const composer = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "s" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: {
        kind: "model",
        input: { text: "gpt", cursor: 1 },
        items: [],
        selected: 0,
        scrollOffset: 0,
        loading: false,
      },
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  }).composer;
  const scene = layoutComposerStatus({ presentation: composer, constraints: { columns: 80, rows: 40 } });
  expect(caretSpans(scene)).toEqual([{ text: "p", role: "cursor" }]);
});

test("caret coordinate tracks the character-preserving wrap", () => {
  const long = "aaa bbb ccc ddd eee fff ggg hhh";
  const scene = composerScene(long, long.length, 20);
  expect(scene.cursor?.row).toBeGreaterThan(1);
});
