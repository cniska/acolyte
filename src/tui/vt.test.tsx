import { describe, expect, test } from "bun:test";
import type React from "react";
import { useEffect, useState } from "react";
import { ansi } from "./styles";
import { renderCapture } from "./test-utils";
import { assertTranscriptIntegrity, replayTerminal, TranscriptIntegrityError, transcriptLines } from "./vt";

/** Drop the unmount-cleanup writes (cursor-show onward) so only frames remain. */
function frameWrites(writes: string[]): string[] {
  const cleanup = writes.findIndex((write) => write.includes(ansi.cursorShow));
  return cleanup >= 0 ? writes.slice(0, cleanup) : writes;
}

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

describe("renderer transcript integrity", () => {
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
