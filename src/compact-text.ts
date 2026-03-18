export type CompactBudget = { maxChars?: number; maxLines?: number };

export const DEFAULT_MAX_CHARS = 4000;
export const DEFAULT_MAX_LINES = 120;

export function compactDetail(value: string, maxChars = 80): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return `${single.slice(0, maxChars - 1).trimEnd()}…`;
}

export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  const headChars = Math.ceil((maxChars - 1) / 2);
  const tailChars = Math.floor((maxChars - 1) / 2);
  return `${text.slice(0, headChars)}…${text.slice(text.length - tailChars)}`;
}

export function compactText(raw: string, options: CompactBudget = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const source = raw.trim();
  if (!source) return raw;

  let truncated = false;
  let lines = source.split("\n");
  if (lines.length > maxLines) {
    const omitted = lines.length - maxLines;
    const headCount = Math.max(1, Math.ceil(maxLines * 0.7));
    const tailCount = Math.max(1, maxLines - headCount);
    const head = lines.slice(0, headCount);
    const tail = lines.slice(lines.length - tailCount);
    lines = [...head, `… ${omitted} lines omitted …`, ...tail];
    truncated = true;
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = truncateMiddle(text, maxChars);
    truncated = true;
  }

  if (!truncated) return text;
  return `${text}\n… output truncated`;
}
