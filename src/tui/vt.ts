/**
 * Minimal pure-JS virtual terminal (VT, as in VT100) for asserting renderer
 * transcript integrity.
 *
 * Models the ANSI subset `render.ts` emits — cursor-up (`ESC[nA`), erase-down
 * (`ESC[J`), carriage return, line feed with scroll, and auto-margin wrap — and
 * ignores the rest (SGR color, sync markers, cursor visibility) since they don't
 * move transcript content between cells.
 *
 * Cells are graphemes measured by `Bun.stringWidth`: a width-2 grapheme (CJK,
 * emoji) occupies a head cell plus an empty continuation cell, so row text
 * round-trips through `join("")`. Wrap is DEFERRED (pending-wrap): after a write
 * fills the last column the cursor parks at the margin and only wraps on the next
 * printable char — a `\r` cancels the pending wrap, a cursor-up commits it. This
 * is exactly the behavior `render.ts` defuses with a trailing `\r`; deleting that
 * `\r` makes an integrity test go red.
 *
 * Scope limits (don't assume coverage):
 * - A CSI sequence (or a grapheme cluster) split across two writes is parsed
 *   per-write; unreachable today since `render.ts` writes complete sequences and
 *   whole clusters.
 * - Erase-down while a wrap is pending does not clear the parked last cell
 *   (`render.ts` always emits `\r` before an erase, resetting the column first).
 * - Terminal resize is not modeled (fixed rows/columns per replay).
 *
 * Unlike a visible-only emulator, lines that scroll off the top are kept in
 * `scrollback` — the committed transcript. That is the invariant the custom
 * renderer must never break: once a line is committed to scrollback it is
 * permanent and must never be dropped, rewritten, duplicated, or merged with
 * another line. A render-to-string test cannot see any of those failures; this
 * can.
 */

const segmenter = new Intl.Segmenter();

export interface VirtualTerminal {
  /** Visible grid rows, right-trimmed. */
  screen: string[];
  /** Rows evicted off the top, in commit order — the permanent transcript. */
  scrollback: string[];
  /** Final cursor row after replay, 0-based in the current screen. */
  row: number;
  /** Final cursor column after replay; equals `columns` when a wrap is pending. */
  col: number;
  /** Replay ended with an uncommitted deferred (pending) wrap. */
  pendingWrap: boolean;
}

export function replayTerminal(writes: string[], rows: number, columns: number): VirtualTerminal {
  const scrollback: string[] = [];
  const screen = Array.from({ length: rows }, () => Array.from({ length: columns }, () => " "));
  let row = 0;
  let col = 0;
  let pendingWrap = false;

  const scroll = (): void => {
    const evicted = screen.shift();
    if (evicted) scrollback.push(evicted.join("").replace(/\s+$/, ""));
    screen.push(Array.from({ length: columns }, () => " "));
    row = rows - 1;
  };

  // A pending wrap counts as "the cursor is on the next row" for anything that
  // prints or moves vertically; `\r` cancels it (that is render.ts's defusal).
  const commitPendingWrap = (): void => {
    if (!pendingWrap) return;
    pendingWrap = false;
    row += 1;
    col = 0;
    if (row >= rows) scroll();
  };

  const eraseDown = (): void => {
    const currentRow = screen[row];
    if (currentRow) {
      // CUU and bare LF preserve the column, so an erase can land on a wide char's
      // continuation cell — blank the head to its left so a half-erased double-width
      // char can't survive (matches xterm). Reachable from the foreign/adversarial
      // writes this harness models, though not from render.ts's own output.
      if (col < columns && currentRow[col] === "" && col - 1 >= 0) currentRow[col - 1] = " ";
      for (let c = col; c < columns; c++) currentRow[c] = " ";
    }
    for (let r = row + 1; r < rows; r++) {
      const nextRow = screen[r];
      if (!nextRow) continue;
      for (let c = 0; c < columns; c++) nextRow[c] = " ";
    }
  };

  // Before writing a grapheme spanning [start, start+width), blank any wide-char
  // partner cell we would orphan: a continuation whose head we overwrite, or a
  // head whose continuation we overwrite.
  const clearSpan = (cells: string[], start: number, width: number): void => {
    if (cells[start] === "" && start - 1 >= 0) cells[start - 1] = " ";
    const last = start + width - 1;
    if (last + 1 < columns && cells[last + 1] === "") cells[last + 1] = " ";
  };

  const placeGrapheme = (g: string): void => {
    let width = Bun.stringWidth(g);
    if (width <= 0) return; // zero-width (stray combining mark) — no cell, no advance
    if (width > 2) width = 2;
    if (pendingWrap) commitPendingWrap();
    // A width-2 grapheme with a single cell left can't be split — wrap it whole.
    if (width === 2 && col === columns - 1) {
      row += 1;
      col = 0;
      if (row >= rows) scroll();
    }
    const target = screen[row];
    if (target && col < columns) {
      clearSpan(target, col, width);
      target[col] = g;
      for (let k = 1; k < width; k++) {
        if (col + k < columns) target[col + k] = "";
      }
    }
    col += width;
    if (col >= columns) {
      col = columns;
      pendingWrap = true;
    }
  };

  const applyWrite = (data: string): void => {
    let index = 0;
    while (index < data.length) {
      const char = data[index];
      if (char === "\x1b") {
        if (data[index + 1] === "[") {
          let end = index + 2;
          while (end < data.length) {
            const code = data.charCodeAt(end);
            if (code >= 0x40 && code <= 0x7e) break;
            end += 1;
          }
          if (end >= data.length) break; // split CSI — out of scope
          const sequence = data.slice(index + 2, end);
          const finalByte = data[end];
          const paramText = sequence.replace(/^\?/, "");
          const param = paramText.length > 0 ? Number.parseInt(paramText, 10) : 1;
          if (finalByte === "A") {
            commitPendingWrap();
            row = Math.max(0, row - (Number.isFinite(param) ? param : 1));
          } else if (finalByte === "J") {
            eraseDown();
          }
          // Other CSI (SGR color, sync markers, cursor visibility) is ignored and
          // must NOT resolve a pending wrap — a styled full-width line ends with
          // `ESC[0m`, which would otherwise false-commit the wrap.
          index = end + 1;
          continue;
        }
        // Lone/unrecognized ESC — skip one char to guarantee progress.
        index += 1;
        continue;
      }
      if (char === "\r") {
        col = 0;
        pendingWrap = false;
        index += 1;
        continue;
      }
      if (char === "\n") {
        // Pure line feed: advance exactly one row, keep the column. A bare `\n` from
        // a foreign write (e.g. a stray console.log) column-splices content — the
        // confirmed weakest-link corruption this harness must catch. render.ts
        // normalizes its own newlines to `\r\n`, so the `\r` resets the column.
        if (pendingWrap) {
          // The cursor is parked at the last column with the last-column flag set.
          // LF clears the flag and advances one row but does NOT carriage-return
          // (raw-mode tty has OPOST off — the reason render.ts normalizes \n to
          // \r\n), so the column is preserved at the last column. Resetting to 0
          // here would hide a foreign-\n splice after a full row — a false green.
          pendingWrap = false;
          col = columns - 1;
        }
        row += 1;
        if (row >= rows) scroll();
        index += 1;
        continue;
      }
      // Printable run: everything up to the next control char, placed grapheme by
      // grapheme so wide chars occupy the right number of cells.
      let runEnd = index + 1;
      while (runEnd < data.length && data[runEnd] !== "\x1b" && data[runEnd] !== "\r" && data[runEnd] !== "\n") {
        runEnd += 1;
      }
      for (const { segment } of segmenter.segment(data.slice(index, runEnd))) placeGrapheme(segment);
      index = runEnd;
    }
  };

  for (const write of writes) applyWrite(write);
  return { screen: screen.map((line) => line.join("").replace(/\s+$/, "")), scrollback, row, col, pendingWrap };
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
