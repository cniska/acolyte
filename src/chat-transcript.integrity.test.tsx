import { describe, expect, test } from "bun:test";
import type React from "react";
import { type ChatRow, createRow } from "./chat-contract";
import { ChatTranscript, ChatTranscriptRow } from "./chat-transcript";
import { Box, Static, Text } from "./tui";
import { assertCursorAccounting, frameWrites, renderScript } from "./tui/test-utils";
import { assertTranscriptIntegrity, replayTerminal, transcriptLines } from "./tui/vt";

const COLUMNS = 40;
// contentWidth = COLUMNS - 2 (marker box). A contentWidth-wide line plus its
// 2-col marker fills the row exactly, parking a pending wrap render.ts must defuse.
const CONTENT_WIDTH = COLUMNS - 2;
const CJK = "日本語のテスト"; // width-2 graphemes — exercises real column arithmetic

// A rich, tricky rowset: a wrapping CJK line, a line that fills the row exactly,
// a tool part with a padded diff bar, a header that wraps at narrow width, and
// plain prose. Each vector (wide-char erase, pending-wrap \r, diff-bar padding,
// narrow header wrap) is present in one transcript.
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

function transcriptOf(rows: ChatRow[]): React.JSX.Element {
  return <ChatTranscript rows={rows} pendingFrame={0} />;
}

/** Render the full rowset in one frame at a viewport tall enough to hold it all;
 *  its committed+visible transcript is the ground truth every other render must
 *  reproduce line-for-line. */
async function oracleTranscript(): Promise<string[]> {
  const frames = await renderScript([transcriptOf(ROWS)], { columns: COLUMNS, rows: 200 });
  return transcriptLines(replayTerminal(frameWrites(frames.flat()), 200, COLUMNS));
}

describe("ChatTranscript transcript integrity", () => {
  test("the oracle transcript is non-trivial and carries every tricky vector", async () => {
    const expected = await oracleTranscript();
    // Guards against a vacuous pass: the transcript must actually contain the CJK
    // line, the diff content, and a line filling the row exactly.
    expect(expected.some((line) => line.includes(CJK))).toBe(true);
    // The diff bar truncates its content to the width budget, so match the prefix.
    expect(expected.some((line) => line.includes("+const value"))).toBe(true);
    expect(expected.some((line) => Bun.stringWidth(line) === COLUMNS)).toBe(true);
  });

  test("streaming rows through an overflowing viewport loses and duplicates nothing", async () => {
    const expected = await oracleTranscript();
    // Grow the transcript one row per frame at a short viewport so the top rows
    // overflow into scrollback — the frozen-prefix path that produced the loss bug.
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, COLUMNS);
    // Every line the tall oracle shows survives exactly once, in order, across the
    // scrollback boundary — no drop, duplicate, or column-splice.
    assertTranscriptIntegrity(vt, expected);
  });

  test("promoting an overflowed turn to <Static> duplicates nothing", async () => {
    // Mirror chat-app's split: completed rows live in <Static> (write-once
    // scrollback), the in-progress turn re-renders live via ChatTranscript. The
    // duplication bug: the turn overflows into scrollback while active, then
    // promotes to <Static> — the static flush re-emits its already-frozen top.
    const contentWidth = Math.max(24, COLUMNS - 2);
    const chatLike = (promoted: ChatRow[], active: ChatRow[]): React.JSX.Element => (
      <Box flexDirection="column">
        <Static items={promoted}>
          {(item: ChatRow) => (
            <Box key={item.id} flexDirection="column">
              <Text> </Text>
              <ChatTranscriptRow row={item} contentWidth={contentWidth} toolContentWidth={contentWidth} />
            </Box>
          )}
        </Static>
        <ChatTranscript rows={active} pendingFrame={0} />
      </Box>
    );
    // Ground truth: the fully-promoted turn rendered once in a tall viewport.
    const oracleFrames = await renderScript([chatLike(ROWS, [])], { columns: COLUMNS, rows: 200 });
    const expected = transcriptLines(replayTerminal(frameWrites(oracleFrames.flat()), 200, COLUMNS));
    // Live turn overflows a short viewport, then promotes to <Static>.
    const frames = await renderScript([chatLike([], ROWS), chatLike(ROWS, [])], { columns: COLUMNS, rows: 6 });
    const vt = replayTerminal(frameWrites(frames.flat()), 6, COLUMNS);
    assertTranscriptIntegrity(vt, expected);
  });

  test("cursor-up distance matches the prior live region on every frame", async () => {
    // Tall viewport → no overflow, so each frame is a pure active re-render and the
    // emitted cursorUp(n) must equal the physical height of the previous frame's
    // live region, measured by the width-aware VT and render's own physicalRowCount.
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 40 });
    assertCursorAccounting(frames, COLUMNS, 40);
  });

  test("cursor-accounting refuses to measure an overflowing viewport", async () => {
    // The invariant only holds without scrollback; the `rows` guard must reject a
    // viewport too short to hold the content rather than silently measure garbage.
    const script = ROWS.map((_, i) => transcriptOf(ROWS.slice(0, i + 1)));
    const frames = await renderScript(script, { columns: COLUMNS, rows: 6 });
    expect(() => assertCursorAccounting(frames, COLUMNS, 6)).toThrow(/precondition violated/);
  });
});
