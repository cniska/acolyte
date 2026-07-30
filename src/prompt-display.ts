const graphemes = new Intl.Segmenter();

// Rows are measured in display cells, the unit the composer box is sized in, while offsets stay
// string indices, the unit the cursor moves in.
function cells(text: string): number {
  return Bun.stringWidth(text);
}

export type PromptDisplayRow = { text: string; startOffset: number };

// Rows tile the value exactly: every character sits in one row, so an offset maps to a row and
// column by summing row lengths. The composer renders these same rows, so its geometry and the
// input handler's line math cannot disagree.
export function promptDisplayRows(value: string, wrapWidth?: number): PromptDisplayRow[] {
  const rows: PromptDisplayRow[] = [];
  let offset = 0;
  for (const line of value.split("\n")) {
    let lineOffset = offset;
    for (const segment of wrapWidth ? softWrapLine(line, wrapWidth) : [line]) {
      rows.push({ text: segment, startOffset: lineOffset });
      lineOffset += segment.length;
    }
    offset += line.length + 1;
  }
  return rows;
}

function rowIndexAt(rows: PromptDisplayRow[], offset: number): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (offset >= (rows[i]?.startOffset ?? 0)) return i;
  }
  return 0;
}

function clampOffset(value: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, value.length));
}

export function cursorLineIndex(value: string, cursorOffset: number, wrapWidth?: number): number {
  return rowIndexAt(promptDisplayRows(value, wrapWidth), clampOffset(value, cursorOffset));
}

export function moveLineUp(value: string, cursor: number, wrapWidth?: number): number {
  return moveRow(value, cursor, wrapWidth, -1);
}

export function moveLineDown(value: string, cursor: number, wrapWidth?: number): number {
  return moveRow(value, cursor, wrapWidth, 1);
}

function moveRow(value: string, cursor: number, wrapWidth: number | undefined, direction: -1 | 1): number {
  const clamped = clampOffset(value, cursor);
  const rows = promptDisplayRows(value, wrapWidth);
  const index = rowIndexAt(rows, clamped);
  const current = rows[index];
  const target = rows[index + direction];
  if (!current || !target) return cursor;
  const column = cells(current.text.slice(0, clamped - current.startOffset));
  let used = 0;
  let offset = target.startOffset;
  for (const { segment } of graphemes.segment(target.text)) {
    const segmentCells = cells(segment);
    if (used + segmentCells > column) break;
    used += segmentCells;
    offset += segment.length;
  }
  return offset;
}

// Greedy word wrap that never drops a character and never returns a row wider than `width` cells:
// a run too long for any row is broken across rows, because the composer box cannot scroll
// sideways. Only a single grapheme too wide for an empty row can exceed the width.
export function softWrapLine(line: string, width: number): string[] {
  if (width <= 0 || cells(line) <= width) return [line];
  const rows: string[] = [];
  let current = "";
  let used = 0;
  const flush = () => {
    rows.push(current);
    current = "";
    used = 0;
  };
  for (const token of line.split(/( +)/)) {
    if (!token) continue;
    const tokenCells = cells(token);
    if (used > 0 && used + tokenCells > width && tokenCells <= width) flush();
    if (used + tokenCells <= width) {
      current += token;
      used += tokenCells;
      continue;
    }
    for (const { segment } of graphemes.segment(token)) {
      const segmentCells = cells(segment);
      if (used > 0 && used + segmentCells > width) flush();
      current += segment;
      used += segmentCells;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows.length > 0 ? rows : [""];
}

export type PromptDisplayLine = {
  before: string;
  cursor: string | null;
  after: string;
};

export function buildPromptDisplayLines(value: string, cursorOffset: number, wrapWidth?: number): PromptDisplayLine[] {
  const clamped = clampOffset(value, cursorOffset);
  const rows = promptDisplayRows(value, wrapWidth);
  const cursorRow = rowIndexAt(rows, clamped);
  return rows.map((row, index) => {
    if (index !== cursorRow) return { before: row.text, cursor: null, after: "" };
    const column = clamped - row.startOffset;
    if (column < row.text.length) {
      return {
        before: row.text.slice(0, column),
        cursor: row.text[column] ?? " ",
        after: row.text.slice(column + 1),
      };
    }
    return { before: row.text, cursor: " ", after: "" };
  });
}
