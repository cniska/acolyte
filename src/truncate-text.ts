const DEFAULT_MAX_DISPLAY_CHARS = 80;

export function truncateText(input: string, maxChars = DEFAULT_MAX_DISPLAY_CHARS): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const dropped = text.length - maxChars;
  const marker = `\n… ${dropped} chars truncated …\n`;
  const budget = maxChars - marker.length;
  if (budget <= 0) return marker;
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  return text.slice(0, head) + marker + text.slice(-tail);
}

const graphemeSegmenter = new Intl.Segmenter();

/**
 * Width-aware truncation: cuts by grapheme so the result (including the `…`) never
 * exceeds `maxWidth` terminal columns per `Bun.stringWidth`. Plain text only — ANSI is
 * applied downstream by the renderers, so don't pass styled strings.
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (Bun.stringWidth(text) <= maxWidth) return text;
  const budget = maxWidth - 1; // reserve one column for the ellipsis
  let out = "";
  let used = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const width = Bun.stringWidth(segment);
    if (used + width > budget) break;
    out += segment;
    used += width;
  }
  return `${out}…`;
}

/**
 * Single-line middle truncation: keeps head and tail around one `…` so the result fits
 * `maxWidth` columns. The tail gets the surplus column so trailing identifiers (filenames
 * at the end of a command) survive. Grapheme- and width-aware; plain text only.
 */
export function truncateMiddleToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (Bun.stringWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  const budget = maxWidth - 1;
  const headBudget = Math.floor(budget / 2);
  const tailBudget = budget - headBudget;
  const segments = [...graphemeSegmenter.segment(text)].map(({ segment }) => segment);
  let head = "";
  let headWidth = 0;
  for (const segment of segments) {
    const width = Bun.stringWidth(segment);
    if (headWidth + width > headBudget) break;
    head += segment;
    headWidth += width;
  }
  let tail = "";
  let tailWidth = 0;
  for (const segment of [...segments].reverse()) {
    const width = Bun.stringWidth(segment);
    if (tailWidth + width > tailBudget) break;
    tail = segment + tail;
    tailWidth += width;
  }
  return `${head}…${tail}`;
}
