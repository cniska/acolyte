const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_LINES = 120;

export function compactToolOutput(raw: string, options: { maxChars?: number; maxLines?: number } = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const source = raw.trim();
  if (!source) {
    return raw;
  }

  let truncated = false;
  let lines = source.split("\n");
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 1))}…`;
    truncated = true;
  }

  if (!truncated) {
    return text;
  }
  return `${text}\n… output truncated`;
}
