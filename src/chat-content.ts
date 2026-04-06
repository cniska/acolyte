export { type HighlightToken, tokenizeForHighlighting } from "./chat-tokenizer";

export function sanitizeAssistantContent(content: string): string {
  const cleaned = content
    .split("\n")
    .map((line) => line.replace(/^\s+(\d+\.\s)/, "$1"))
    .filter((line) => !/^\s*(Tools used:|Evidence:)/.test(line))
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
