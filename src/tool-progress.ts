export type ToolProgressParsedLine =
  | { kind: "header"; verb: "Wrote" | "Edited" | "Read" | "Deleted" | "Ran"; path: string }
  | { kind: "numberedDiff"; lineNumber: string; spacing: string; marker: "+" | "-"; text: string }
  | { kind: "numberedContext"; lineNumber: string; spacing: string; text: string }
  | { kind: "plainDiff"; marker: "+" | "-"; text: string }
  | { kind: "text"; text: string };

export function isToolHeaderLine(line: string): boolean {
  return /^(Wrote|Edited|Read|Deleted|Ran)\s+\S/.test(line.trim());
}

export function isToolDetailLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^\d+\s+[+-]\s/.test(trimmed) ||
    /^\d+\s{3}/.test(trimmed) ||
    /^[+-]\s/.test(trimmed) ||
    /^(code|out|err)\s*\|/.test(trimmed)
  );
}

export function groupToolProgressMessages(messages: string[]): string[] {
  const grouped: string[] = [];
  const seen = new Set<string>();
  for (const rawMessage of messages) {
    const message = rawMessage.trim();
    if (!message) {
      continue;
    }
    const key = message.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (grouped.length === 0) {
      grouped.push(message);
      continue;
    }
    if (isToolHeaderLine(message)) {
      grouped.push(message);
      continue;
    }
    const previous = grouped[grouped.length - 1] ?? "";
    const previousFirstLine = previous.split("\n")[0] ?? "";
    if (isToolHeaderLine(previousFirstLine) || (isToolDetailLine(previous) && isToolDetailLine(message))) {
      grouped[grouped.length - 1] = `${previous}\n${message}`;
      continue;
    }
    grouped.push(message);
  }
  return grouped;
}

export function parseToolProgressLine(line: string): ToolProgressParsedLine {
  const header = line.match(/^(Wrote|Edited|Read|Deleted|Ran)\s+(.+)$/);
  if (header) {
    return {
      kind: "header",
      verb: header[1] as "Wrote" | "Edited" | "Read" | "Deleted" | "Ran",
      path: header[2] ?? "",
    };
  }
  const numberedDiff = line.match(/^(\d+)(\s+)([+-])\s(.*)$/);
  if (numberedDiff) {
    return {
      kind: "numberedDiff",
      lineNumber: numberedDiff[1] ?? "",
      spacing: numberedDiff[2] ?? " ",
      marker: (numberedDiff[3] as "+" | "-") ?? "+",
      text: numberedDiff[4] ?? "",
    };
  }
  const numberedContext = line.match(/^(\d+)(\s{3})(.*)$/);
  if (numberedContext) {
    return {
      kind: "numberedContext",
      lineNumber: numberedContext[1] ?? "",
      spacing: numberedContext[2] ?? "   ",
      text: numberedContext[3] ?? "",
    };
  }
  if (line.startsWith("+ ")) {
    return { kind: "plainDiff", marker: "+", text: line };
  }
  if (line.startsWith("- ")) {
    return { kind: "plainDiff", marker: "-", text: line };
  }
  return { kind: "text", text: line };
}
