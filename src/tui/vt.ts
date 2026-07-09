/**
 * Minimal pure-JS virtual terminal (VT, as in VT100) for asserting renderer
 * transcript integrity.
 *
 * Models the ANSI subset `render.ts` emits — cursor-up (`ESC[nA`), erase-down
 * (`ESC[J`), carriage return, line feed with scroll, and auto-margin wrap — and
 * ignores the rest (SGR color, sync markers, cursor visibility) since they don't
 * move transcript content between cells.
 *
 * Scope limits (don't assume coverage — each needs its own guard):
 * - Wrap is EAGER (wrap on writing the last column), not the deferred/pending-wrap
 *   of real terminals, so this does NOT cover the pending-wrap overshoot that
 *   `render.ts:127` defuses with a trailing `\r` — deleting that `\r` stays green.
 * - Cells advance one per UTF-16 code unit; `render.ts` measures with
 *   `Bun.stringWidth`, so wide (CJK/emoji) content diverges — don't write an
 *   emoji integrity test against this.
 * - A CSI sequence split across two writes is dropped mid-parse; unreachable
 *   today since `render.ts` always writes complete sequences.
 *
 * Unlike a visible-only emulator, lines that scroll off the top are kept in
 * `scrollback` — the committed transcript. That is the invariant the custom
 * renderer must never break: once a line is committed to scrollback it is
 * permanent and must never be dropped, rewritten, duplicated, or merged with
 * another line. A render-to-string test cannot see any of those failures; this
 * can.
 */

export interface VirtualTerminal {
  /** Visible grid rows, right-trimmed. */
  screen: string[];
  /** Rows evicted off the top, in commit order — the permanent transcript. */
  scrollback: string[];
}

export function replayTerminal(writes: string[], rows: number, columns: number): VirtualTerminal {
  const scrollback: string[] = [];
  const screen = Array.from({ length: rows }, () => Array.from({ length: columns }, () => " "));
  let row = 0;
  let col = 0;

  const scroll = (): void => {
    const evicted = screen.shift();
    if (evicted) scrollback.push(evicted.join("").replace(/\s+$/, ""));
    screen.push(Array.from({ length: columns }, () => " "));
    row = rows - 1;
  };

  const eraseDown = (): void => {
    const currentRow = screen[row];
    if (currentRow) {
      for (let c = col; c < columns; c++) currentRow[c] = " ";
    }
    for (let r = row + 1; r < rows; r++) {
      const nextRow = screen[r];
      if (!nextRow) continue;
      for (let c = 0; c < columns; c++) nextRow[c] = " ";
    }
  };

  const applyWrite = (data: string): void => {
    let index = 0;
    while (index < data.length) {
      const char = data[index];
      if (char === "\x1b" && data[index + 1] === "[") {
        let end = index + 2;
        while (end < data.length) {
          const code = data.charCodeAt(end);
          if (code >= 0x40 && code <= 0x7e) break;
          end += 1;
        }
        if (end >= data.length) break;
        const sequence = data.slice(index + 2, end);
        const finalByte = data[end];
        const paramText = sequence.replace(/^\?/, "");
        const param = paramText.length > 0 ? Number.parseInt(paramText, 10) : 1;
        if (finalByte === "A") {
          row = Math.max(0, row - (Number.isFinite(param) ? param : 1));
        } else if (finalByte === "J") {
          eraseDown();
        }
        index = end + 1;
        continue;
      }
      if (char === "\r") {
        col = 0;
        index += 1;
        continue;
      }
      if (char === "\n") {
        // Pure line feed: advance the row, keep the column. A bare `\n` from a
        // foreign write (e.g. a stray console.log) column-splices content — the
        // confirmed weakest-link corruption this harness must catch. render.ts
        // normalizes its own newlines to `\r\n`, so the `\r` resets the column.
        row += 1;
        if (row >= rows) scroll();
        index += 1;
        continue;
      }
      if (col >= columns) {
        row += 1;
        col = 0;
        if (row >= rows) scroll();
      }
      const target = screen[row];
      if (target && col >= 0 && col < columns) target[col] = char ?? " ";
      col += 1;
      index += 1;
    }
  };

  for (const write of writes) applyWrite(write);
  return { screen: screen.map((line) => line.join("").replace(/\s+$/, "")), scrollback };
}

/** Committed (scrollback) + visible (screen) transcript, trailing blanks dropped. */
export function transcriptLines(vt: VirtualTerminal): string[] {
  const all = [...vt.scrollback, ...vt.screen];
  let end = all.length;
  while (end > 0 && all[end - 1] === "") end -= 1;
  return all.slice(0, end);
}

export class TranscriptIntegrityError extends Error {
  constructor(
    readonly actual: string[],
    readonly expected: string[],
  ) {
    super(
      `transcript integrity violation\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
    this.name = "TranscriptIntegrityError";
  }
}

/**
 * Assert the committed+visible transcript exactly equals `expected`, in order.
 * A mismatch is a dropped line (loss), a repeated line (duplication), a merged
 * row (interleaving), or a reordering — the transcript-corruption class.
 */
export function assertTranscriptIntegrity(vt: VirtualTerminal, expected: string[]): void {
  const actual = transcriptLines(vt);
  if (actual.length !== expected.length || actual.some((line, i) => line !== expected[i])) {
    throw new TranscriptIntegrityError(actual, expected);
  }
}
