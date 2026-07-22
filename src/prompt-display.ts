export function cursorLineIndex(value: string, cursorOffset: number, wrapWidth?: number): number {
  const clamped = Math.max(0, Math.min(cursorOffset, value.length));
  if (!wrapWidth) return value.slice(0, clamped).split("\n").length - 1;
  const lines = buildPromptDisplayLines(value, clamped, wrapWidth);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.cursor !== null) return i;
  }
  return 0;
}

export function moveLineUp(value: string, cursor: number, wrapWidth?: number): number {
  if (wrapWidth) return moveVisualLine(value, cursor, wrapWidth, -1);
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, clamped);
  const currentLineStart = before.lastIndexOf("\n") + 1;
  if (currentLineStart === 0) return cursor;
  const column = clamped - currentLineStart;
  const prevLineEnd = currentLineStart - 1;
  const prevLineStart = before.lastIndexOf("\n", prevLineEnd - 1) + 1;
  const prevLineLength = prevLineEnd - prevLineStart;
  return prevLineStart + Math.min(column, prevLineLength);
}

export function moveLineDown(value: string, cursor: number, wrapWidth?: number): number {
  if (wrapWidth) return moveVisualLine(value, cursor, wrapWidth, 1);
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, clamped);
  const currentLineStart = before.lastIndexOf("\n") + 1;
  const column = clamped - currentLineStart;
  const nextNewline = value.indexOf("\n", clamped);
  if (nextNewline === -1) return cursor;
  const nextLineStart = nextNewline + 1;
  const nextNextNewline = value.indexOf("\n", nextLineStart);
  const nextLineLength = (nextNextNewline === -1 ? value.length : nextNextNewline) - nextLineStart;
  return nextLineStart + Math.min(column, nextLineLength);
}

function moveVisualLine(value: string, cursor: number, wrapWidth: number, direction: -1 | 1): number {
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const displayLines = buildPromptDisplayLines(value, clamped, wrapWidth);
  let currentIdx = 0;
  for (let i = displayLines.length - 1; i >= 0; i--) {
    if (displayLines[i]?.cursor !== null) {
      currentIdx = i;
      break;
    }
  }
  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= displayLines.length) return cursor;
  let currentStartOffset = 0;
  const logicalLines = value.split("\n");
  let offset = 0;
  outer: for (const line of logicalLines) {
    const wrapped = softWrapLine(line, wrapWidth);
    let lineOffset = offset;
    for (const segment of wrapped) {
      if (lineOffset <= clamped && clamped <= lineOffset + segment.length) {
        currentStartOffset = lineOffset;
        break outer;
      }
      lineOffset += segment.length;
    }
    offset += line.length + 1;
  }
  const column = clamped - currentStartOffset;

  // Find target display line's start offset
  let targetStartOffset = 0;
  let displayIdx = 0;
  offset = 0;
  for (const line of logicalLines) {
    const wrapped = softWrapLine(line, wrapWidth);
    let lineOffset = offset;
    for (const segment of wrapped) {
      if (displayIdx === targetIdx) {
        targetStartOffset = lineOffset;
        const targetLength = segment.length;
        return targetStartOffset + Math.min(column, targetLength);
      }
      lineOffset += segment.length;
      displayIdx++;
    }
    offset += line.length + 1;
  }
  return cursor;
}

export function softWrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const words = line.split(/( +)/);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length <= width || current.length === 0) {
      current += word;
    } else {
      result.push(current);
      current = word.trimStart();
    }
  }
  if (current.length > 0) result.push(current);
  return result.length > 0 ? result : [""];
}

export type PromptDisplayLine = {
  before: string;
  cursor: string | null;
  after: string;
};

export function buildPromptDisplayLines(value: string, cursorOffset: number, wrapWidth?: number): PromptDisplayLine[] {
  const clamped = Math.max(0, Math.min(cursorOffset, value.length));
  const logicalLines = value.split("\n");
  const displayLines: { text: string; startOffset: number }[] = [];
  let offset = 0;
  for (let i = 0; i < logicalLines.length; i++) {
    const line = logicalLines[i] ?? "";
    const wrapped = wrapWidth ? softWrapLine(line, wrapWidth) : [line];
    let lineOffset = offset;
    for (const segment of wrapped) {
      displayLines.push({ text: segment, startOffset: lineOffset });
      lineOffset += segment.length;
    }
    offset += line.length + 1; // +1 for \n
  }
  let cursorDisplayLine = 0;
  for (let i = displayLines.length - 1; i >= 0; i--) {
    const dl = displayLines[i];
    if (dl && clamped >= dl.startOffset) {
      cursorDisplayLine = i;
      break;
    }
  }
  return displayLines.map((dl, index) => {
    if (index !== cursorDisplayLine) return { before: dl.text, cursor: null, after: "" };
    const col = clamped - dl.startOffset;
    if (col < dl.text.length) {
      return {
        before: dl.text.slice(0, col),
        cursor: dl.text[col] ?? " ",
        after: dl.text.slice(col + 1),
      };
    }
    return { before: dl.text, cursor: " ", after: "" };
  });
}
