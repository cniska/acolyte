import { describe, expect, test } from "bun:test";
import type React from "react";
import { useEffect, useState } from "react";
import { ansi } from "./styles";
import { frameWrites, renderCapture } from "./test-utils";
import { assertTranscriptIntegrity, replayTerminal, TranscriptIntegrityError, transcriptLines } from "./vt";

describe("replayTerminal", () => {
  test("keeps lines that scroll off the top in scrollback", () => {
    const vt = replayTerminal(["a\r\nb\r\nc\r\nd\r\ne"], 3, 20);
    expect(vt.scrollback).toEqual(["a", "b"]);
    expect(vt.screen).toEqual(["c", "d", "e"]);
    expect(transcriptLines(vt)).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("wraps at the right margin", () => {
    const vt = replayTerminal(["abcdef"], 3, 3);
    expect(transcriptLines(vt)).toEqual(["abc", "def"]);
  });

  test("erase-down clears from the cursor to the end of the screen", () => {
    const vt = replayTerminal(["one\r\ntwo\r\nthree", `${ansi.cursorUp(1)}\r${ansi.eraseDown}`], 4, 10);
    expect(transcriptLines(vt)).toEqual(["one"]);
  });
});

describe("replayTerminal — width & deferred wrap", () => {
  test("a wide grapheme exactly filling the row stays one line", () => {
    // あ(2) + あ(2) + a(1) = 5 columns exactly.
    expect(transcriptLines(replayTerminal(["ああa"], 4, 5))).toEqual(["ああa"]);
  });

  test("a wide grapheme with one cell left wraps whole, never split", () => {
    // x(1) leaves col at 3; the second あ can't fit in the single last cell.
    expect(transcriptLines(replayTerminal(["xああ"], 4, 4))).toEqual(["xあ", "あ"]);
  });

  test("an exactly-full row followed by \\r\\n produces no blank row", () => {
    expect(transcriptLines(replayTerminal(["abcde\r\nnext"], 4, 5))).toEqual(["abcde", "next"]);
  });

  test("a pending wrap commits on the next printable char", () => {
    expect(transcriptLines(replayTerminal(["abcdef"], 4, 5))).toEqual(["abcde", "f"]);
  });

  test("a bare line feed while a wrap is pending advances one row, preserving the column", () => {
    // LF advances one row (not two) and clears the last-column flag, but does NOT
    // carriage-return — so a foreign \n after a full row shows the column splice
    // (X on the last column), never a clean col-0 write that would hide corruption.
    expect(transcriptLines(replayTerminal(["abcde\nX"], 4, 5))).toEqual(["abcde", "    X"]);
  });

  test("erase-down landing on a wide char's continuation blanks the orphaned head", () => {
    // CUU preserves the column onto the あ continuation at col 2; erase-down must
    // blank the あ head at col 1 so no half-erased double-width char survives.
    const vt = replayTerminal(["xあ\r\nab", `${ansi.cursorUp(1)}${ansi.eraseDown}`], 4, 5);
    expect(transcriptLines(vt)).toEqual(["x"]);
  });

  test("cursor-up commits a pending wrap; a preceding \\r cancels it", () => {
    // Without the \r, the full row parks a pending wrap that cursor-up commits, so
    // CUU(1) lands on the "abcde" row and erase-down leaves "one".
    const committed = replayTerminal(["one\r\nabcde", `${ansi.cursorUp(1)}\r${ansi.eraseDown}`], 5, 5);
    expect(transcriptLines(committed)).toEqual(["one"]);
    // With the \r, the pending wrap is cancelled, CUU(1) lands one row higher, and
    // erase-down wipes everything — this is exactly render.ts's trailing-\r defusal.
    const cancelled = replayTerminal(["one\r\nabcde\r", `${ansi.cursorUp(1)}\r${ansi.eraseDown}`], 5, 5);
    expect(transcriptLines(cancelled)).toEqual([]);
  });

  test("SGR (color reset) does not commit a pending wrap", () => {
    // If ESC[0m committed the wrap, \r+X would land on a new row → ["abcde","X"].
    expect(transcriptLines(replayTerminal(["abcde\x1b[0m\rX"], 5, 5))).toEqual(["Xbcde"]);
  });

  test("overwriting a wide head blanks its orphaned continuation cell", () => {
    // あ occupies col0-1; writing x over col0 must blank col1 so it does not merge
    // with the following b as "xb".
    expect(transcriptLines(replayTerminal(["あb\rx"], 4, 5))).toEqual(["x b"]);
  });

  test("a wide grapheme cluster survives scroll into scrollback intact", () => {
    const vt = replayTerminal(["👩‍👩‍👧\r\nL2\r\nL3"], 2, 10);
    expect(vt.scrollback).toEqual(["👩‍👩‍👧"]);
    expect(transcriptLines(vt)).toEqual(["👩‍👩‍👧", "L2", "L3"]);
  });
});

describe("assertTranscriptIntegrity", () => {
  test("passes when the committed+visible transcript matches", () => {
    const vt = replayTerminal(["a\r\nb\r\nc"], 5, 20);
    expect(() => assertTranscriptIntegrity(vt, ["a", "b", "c"])).not.toThrow();
  });

  test("catches a dropped line", () => {
    const vt = replayTerminal(["a\r\nc"], 5, 20);
    expect(() => assertTranscriptIntegrity(vt, ["a", "b", "c"])).toThrow(TranscriptIntegrityError);
  });

  test("catches a duplicated line", () => {
    const vt = replayTerminal(["a\r\nb\r\nb"], 5, 20);
    expect(() => assertTranscriptIntegrity(vt, ["a", "b"])).toThrow(TranscriptIntegrityError);
  });

  test("catches a tool-result fragment interleaved into a prose line", () => {
    // The reported corruption shape: prose is written, the cursor returns to
    // column 0 of the same row, and a diff fragment overwrites it — the two
    // logical lines collapse onto one row.
    const vt = replayTerminal(["That is the answer\r124 -# allowed_mime_types"], 5, 40);
    expect(transcriptLines(vt)).toEqual(["124 -# allowed_mime_types"]);
    expect(() => assertTranscriptIntegrity(vt, ["That is the answer", "124 -# allowed_mime_types"])).toThrow(
      TranscriptIntegrityError,
    );
  });

  test("catches a bare-LF foreign write that column-splices the next line", () => {
    // A stray `\n` with no `\r` (e.g. a foreign console.log) leaves the column
    // where it was, offsetting the next line — the corruption render.ts avoids by
    // normalizing its own newlines to `\r\n`.
    const vt = replayTerminal(["hello\nworld"], 5, 20);
    expect(transcriptLines(vt)).toEqual(["hello", "     world"]);
    expect(() => assertTranscriptIntegrity(vt, ["hello", "world"])).toThrow(TranscriptIntegrityError);
  });
});

function LinesApp(props: { unmount: () => void; lines: string[] }): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(props.unmount, 40);
    return () => clearTimeout(timer);
  }, [props.unmount]);
  return (
    <tui-box flexDirection="column">
      {props.lines.map((line) => (
        <tui-text key={line}>{line}</tui-text>
      ))}
    </tui-box>
  );
}

const ALL = Array.from({ length: 11 }, (_, i) => `L${i + 1}`);

/** Appends lines across several frames so the overflow frozen-prefix grows
 *  incrementally (render.ts:199-205) — the path that produced the corruption. */
function GrowingLinesApp(props: { unmount: () => void }): React.JSX.Element {
  const [count, setCount] = useState(7);
  useEffect(() => {
    const t1 = setTimeout(() => setCount(9), 20);
    const t2 = setTimeout(() => setCount(11), 40);
    const t3 = setTimeout(props.unmount, 60);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [props.unmount]);
  return (
    <tui-box flexDirection="column">
      {ALL.slice(0, count).map((line) => (
        <tui-text key={line}>{line}</tui-text>
      ))}
    </tui-box>
  );
}

function ExactWidthApp(props: { unmount: () => void }): React.JSX.Element {
  const [withC, setWithC] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setWithC(true), 20);
    const t2 = setTimeout(props.unmount, 40);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [props.unmount]);
  return (
    <tui-box flexDirection="column">
      <tui-text>a</tui-text>
      <tui-text>{"B".repeat(10)}</tui-text>
      {withC ? <tui-text>c</tui-text> : null}
    </tui-box>
  );
}

describe("renderer transcript integrity", () => {
  test("an exactly-full-width line does not desync the erase math across frames", async () => {
    // The "BBBBBBBBBB" line is exactly `columns`, so it parks a pending wrap. render.ts's
    // trailing `\r` cancels it before the next frame's cursor-up; deleting that `\r`
    // (render.ts:132) makes cursor-up land one row low and duplicate "a" — caught here.
    const writes = await renderCapture(({ unmount }) => <ExactWidthApp unmount={unmount} />, {
      columns: 10,
      rows: 6,
    });
    const vt = replayTerminal(frameWrites(writes), 6, 10);
    assertTranscriptIntegrity(vt, ["a", "BBBBBBBBBB", "c"]);
  });

  test("every overflowing line survives in the transcript exactly once", async () => {
    const lines = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    const writes = await renderCapture(({ unmount }) => <LinesApp unmount={unmount} lines={lines} />, {
      columns: 20,
      rows: 6,
    });
    const vt = replayTerminal(frameWrites(writes), 6, 20);
    // L1-L3 scroll into scrollback, L4-L8 stay on screen — none lost, none duplicated.
    assertTranscriptIntegrity(vt, lines);
  });

  test("lines committed across incremental overflow frames survive in order", async () => {
    const writes = await renderCapture(({ unmount }) => <GrowingLinesApp unmount={unmount} />, {
      columns: 20,
      rows: 6,
    });
    const vt = replayTerminal(frameWrites(writes), 6, 20);
    // Overflow grows 7 → 9 → 11 lines across frames; every committed line stays,
    // exactly once, in order — no loss or duplication as the frozen prefix extends.
    assertTranscriptIntegrity(vt, ALL);
  });
});
