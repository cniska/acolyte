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
