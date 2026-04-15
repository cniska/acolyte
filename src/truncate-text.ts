const DEFAULT_MAX_DISPLAY_CHARS = 80;

export function truncateText(input: string, maxChars = DEFAULT_MAX_DISPLAY_CHARS): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}
