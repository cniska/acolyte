import { describe, expect, test } from "bun:test";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { renderToString } from "./tui/render-to-string";
import { stripAnsiLength } from "./tui/serialize";
import { withTerminalWidth } from "./tui/test-utils";

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

function composerRowWidths(
  suggestions: Parameters<typeof createChatViewportPresentation>[0]["composer"]["suggestions"],
  columns: number,
): number[] {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "@", cursor: 1 },
      picker: null,
      suggestions,
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({ presentation, constraints: { columns, rows: 40 }, theme: terminalTheme, now: 0 });
  const raw = withTerminalWidth(columns, () => renderToString(<TerminalSceneRender scene={scene} />));
  return raw.split("\n").map((line) => stripAnsiLength(line));
}

describe("composer suggestion clipping", () => {
  test("clips overflowing @-mention suggestions to the terminal width", () => {
    const widths = composerRowWidths(
      {
        kind: "at",
        query: "s",
        candidates: ["src/some/really/long/nested/path/to/a/file/that/overflows.tsx", "short.ts"],
        selected: 0,
      },
      40,
    );
    for (const width of widths) expect(width).toBeLessThanOrEqual(40);
    // The widest row is the composer box, whose right border sits at the last column
    // before the 1ch right gutter (trailing whitespace the renderer trims).
    expect(Math.max(...widths)).toBe(39);
  });

  test("clips overflowing slash-command suggestions to the terminal width", () => {
    const widths = composerRowWidths(
      { kind: "slash", candidates: ["/some-really-long-slash-command-name-that-overflows", "/help"], selected: 0 },
      40,
    );
    for (const width of widths) expect(width).toBeLessThanOrEqual(40);
  });
});
