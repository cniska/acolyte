import { compactText, DEFAULT_MAX_CHARS, DEFAULT_MAX_LINES } from "./compact-text";

export function compactToolOutput(raw: string, options: { maxChars?: number; maxLines?: number } = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const source = raw.trim();
  if (!source) return raw;

  // Preserve unified-diff structure so downstream preview parsers remain stable.
  let lines = source.split("\n");
  let lineTruncated = false;
  if (lines.length > maxLines) {
    const omitted = lines.length - maxLines;
    const headCount = Math.max(1, Math.ceil(maxLines * 0.7));
    const tailCount = Math.max(1, maxLines - headCount);
    const head = lines.slice(0, headCount);
    const tail = lines.slice(lines.length - tailCount);
    lines = [...head, `… ${omitted} lines omitted …`, ...tail];
    lineTruncated = true;
  }

  const text = lines.join("\n");
  if (text.length > maxChars && text.includes("diff --git ")) {
    if (!lineTruncated) return `${text}\n… output truncated`;
    return text;
  }

  return compactText(raw, { maxChars, maxLines });
}
