import { describe, expect, test } from "bun:test";
import type React from "react";
import { type ChatRow, createRow } from "./chat-contract";
import { migrateLegacyChatRow } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import type { TerminalScene } from "./terminal-scene-contract";
import { terminalTheme } from "./terminal-theme";
import { TerminalSceneViewport } from "./tui";
import { assertCursorAccounting, frameWrites, renderScript } from "./tui/test-utils";
import { assertTranscriptIntegrity, replayTerminal, transcriptLines } from "./tui/vt";

const COLUMNS = 40;
// contentWidth = COLUMNS - 2 (marker gutter). A contentWidth-wide line plus its 2-col
// gutter fills the row exactly, parking a pending wrap render.ts must defuse.
const CONTENT_WIDTH = COLUMNS - 2;
const CJK = "日本語のテスト"; // width-2 graphemes — exercises real column arithmetic

// A rich, tricky rowset: a wrapping CJK line, a line that fills the row exactly, a tool part
// with a padded diff bar, and plain prose. Each vector (wide-char erase, pending-wrap \r,
// diff-bar padding) is present in one transcript.
const ROWS: ChatRow[] = [
  createRow("user", "run the analysis on the report"),
  createRow("assistant", `解析結果: ${CJK}${CJK}${CJK}`),
  createRow("assistant", "X".repeat(CONTENT_WIDTH)),
  createRow("tool", {
    parts: [
      { kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/report.ts" },
      { kind: "diff", marker: "add", lineNumber: 1, text: "const value = computeExpensiveThing(input, options)" },
      { kind: "diff", marker: "remove", lineNumber: 2, text: "let value = 1" },
    ],
  }),
  createRow("assistant", "and that is the final summary line of the reply body"),
];

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

// The transcript region of the production scene (between the header and the composer). This
// is the same pipeline chat-app renders; driving the integrity oracle through it makes the
// render-loop invariants hold against real layout output, not a hand-built stand-in.
function transcriptScene(rows: ChatRow[]): TerminalScene {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: rows.map(migrateLegacyChatRow),
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: COLUMNS, rows: 1000 },
    theme: terminalTheme,
    now: 0,
  });
  const header = scene.sections?.find((section) => section.id === "header");
  const composer = scene.sections?.find((section) => section.id === "composer");
  return { lines: scene.lines.slice(header?.lineEnd, composer?.lineStart) };
}

function transcriptOf(rows: ChatRow[]): React.JSX.Element {
  return (
    <TerminalSceneViewport
      scene={transcriptScene(rows)}
      constraints={{ columns: COLUMNS, rows: 200 }}
      liveLineStart={0}
    />
  );
}

/** Render the full rowset in one frame at a viewport tall enough to hold it all; its
 *  committed+visible transcript is the ground truth every other render must reproduce. */
async function oracleTranscript(): Promise<string[]> {
  const frames = await renderScript([transcriptOf(ROWS)], { columns: COLUMNS, rows: 200 });
  return transcriptLines(replayTerminal(frameWrites(frames.flat()), 200, COLUMNS));
}

describe("scene transcript integrity", () => {
  test("the oracle transcript is non-trivial and carries every tricky vector", async () => {
    const expected = await oracleTranscript();
    expect(expected.some((line) => line.includes(CJK))).toBe(true);
    expect(expected.some((line) => line.includes("+ const value"))).toBe(true);
    expect(expected.some((line) => Bun.stringWidth(line) === COLUMNS)).toBe(true);
  });

  test("streaming rows through an overflowing viewport loses and duplicates nothing", async () => {
    const expected = await oracleTranscript();
    // Grow the transcript one row per frame at a short viewport so the top rows overflow into
    // scrollback — the frozen-prefix path that produced the loss bug.
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, COLUMNS);
    assertTranscriptIntegrity(vt, expected);
  });

  test("cursor-up distance matches the prior live region on every frame", async () => {
    // Tall viewport → no overflow, so each frame is a pure active re-render and the emitted
    // cursorUp(n) must equal the physical height of the previous frame's live region.
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 40 });
    assertCursorAccounting(frames, COLUMNS, 40);
  });

  test("cursor-accounting refuses to measure an overflowing viewport", async () => {
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 6 });
    expect(() => assertCursorAccounting(frames, COLUMNS, 6)).toThrow(/precondition violated/);
  });
});
