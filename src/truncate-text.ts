const DEFAULT_MAX_DISPLAY_CHARS = 80;

export function truncateText(input: string, maxChars = DEFAULT_MAX_DISPLAY_CHARS): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.length - maxChars;
  const marker = `\n… ${truncated} chars truncated …\n`;
  const budget = maxChars - marker.length;
  if (budget <= 0) return marker;
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  return text.slice(0, head) + marker + text.slice(-tail);
}
