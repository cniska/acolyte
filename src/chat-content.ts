export { type MarkupToken, tokenize } from "./chat-tokenizer";

export type AssistantSegment =
  | { kind: "prose"; text: string }
  | { kind: "code"; lang: string; text: string; closed: boolean };

const FENCE_LINE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

function stripIndent(line: string, max: number): string {
  let n = 0;
  while (n < max && (line[n] === " " || line[n] === "\t")) n++;
  return line.slice(n);
}

// Fenced-code pre-pass over raw assistant text. Runs before the line-oriented tokenizer because a
// fence spans multiple lines; splitting prose from code first keeps prose-only transforms (the
// numbered-list dedent in sanitizeAssistantContent, inline markup in tokenize) off code, which must
// survive character-for-character. Shared by the chat layout and the CLI reply formatter.
export function segmentAssistantContent(text: string): AssistantSegment[] {
  const lines = text.split("\n");
  const segments: AssistantSegment[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    segments.push({ kind: "prose", text: prose.join("\n") });
    prose = [];
  };

  for (let i = 0; i < lines.length; ) {
    const opener = (lines[i] ?? "").match(FENCE_LINE);
    const fence = opener?.[2] ?? "";
    const info = opener?.[3] ?? "";
    // A backtick info string may not itself contain a backtick (CommonMark); tilde fences may.
    if (opener === null || (fence.startsWith("`") && info.includes("`"))) {
      prose.push(lines[i] ?? "");
      i++;
      continue;
    }
    flushProse();
    const indent = (opener[1] ?? "").length;
    const fenceChar = fence.charAt(0);
    const lang = info.trim().split(/\s+/)[0] ?? "";
    const body: string[] = [];
    let closed = false;
    i++;
    for (; i < lines.length; i++) {
      const close = (lines[i] ?? "").match(FENCE_CLOSE);
      const closeFence = close?.[1] ?? "";
      if (closeFence.charAt(0) === fenceChar && closeFence.length >= fence.length) {
        closed = true;
        i++;
        break;
      }
      body.push(stripIndent(lines[i] ?? "", indent));
    }
    segments.push({ kind: "code", lang, text: body.join("\n"), closed });
  }
  flushProse();
  return segments;
}

const codeGraphemes = new Intl.Segmenter();

// Character-preserving hard wrap for one logical code line: breaks at the last grapheme that fits the
// display-width budget (Bun.stringWidth), never word-wraps or truncates, because code is read and
// copied. A blank line yields one empty row so vertical spacing survives. Pure geometry — takes a
// width budget, never physical columns — and shared by the chat layout and the CLI reply formatter.
export function wrapCodeText(text: string, budget: number): string[] {
  const limit = Math.max(1, budget);
  const rows: string[] = [];
  let row = "";
  let used = 0;
  for (const { segment } of codeGraphemes.segment(text)) {
    const cell = Bun.stringWidth(segment);
    if (used > 0 && used + cell > limit) {
      rows.push(row);
      row = "";
      used = 0;
    }
    row += segment;
    used += cell;
  }
  rows.push(row);
  return rows;
}

export function sanitizeAssistantContent(content: string): string {
  const cleaned = content
    .split("\n")
    .map((line) => line.replace(/^\s+(\d+\.\s)/, "$1"))
    .join("\n")
    .trimEnd();
  return cleaned;
}

function wrapWithIndent(prefix: string, continuationPrefix: string, body: string, width: number): string[] {
  const words = body.trim().split(/\s+/);
  if (words.length === 0) return [prefix.trimEnd()];

  const lines: string[] = [];
  let current = prefix;
  let currentPrefix = prefix;

  for (const word of words) {
    const atLineStart = current === currentPrefix;
    const candidate = atLineStart ? `${current}${word}` : `${current} ${word}`;
    if (candidate.length <= width || atLineStart) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = `${continuationPrefix}${word}`;
    currentPrefix = continuationPrefix;
  }

  lines.push(current);
  return lines;
}

function wrapSingleLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];

  const numbered = line.match(/^(\s*\d+\.\s+)(.*)$/);
  if (numbered) {
    const prefix = numbered[1] ?? "";
    const body = numbered[2] ?? "";
    return wrapWithIndent(prefix, " ".repeat(prefix.length), body, width);
  }

  const baseIndent = line.match(/^\s*/)?.[0] ?? "";
  const body = line.slice(baseIndent.length);
  return wrapWithIndent(baseIndent, baseIndent, body, width);
}

export function wrapText(content: string, width: number): string {
  const normalizedWidth = Math.max(24, width);
  return content
    .split("\n")
    .flatMap((line) => {
      if (line.length <= normalizedWidth) return [line];
      return wrapWithIndent("", "", line, normalizedWidth);
    })
    .join("\n");
}

export function wrapAssistantContent(content: string, width: number): string {
  const normalizedWidth = Math.max(24, width);
  return content
    .split("\n")
    .flatMap((line) => (line.length === 0 ? [""] : wrapSingleLine(line, normalizedWidth)))
    .join("\n");
}
