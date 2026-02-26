export type ToolProgressParsedLine =
  | { kind: "header"; verb: "Wrote" | "Edited" | "Read" | "Deleted" | "Ran"; path: string }
  | { kind: "numberedDiff"; lineNumber: string; spacing: string; marker: "+" | "-"; text: string }
  | { kind: "numberedContext"; lineNumber: string; spacing: string; text: string }
  | { kind: "plainDiff"; marker: "+" | "-"; text: string }
  | { kind: "text"; text: string };

export function parseToolProgressLine(line: string): ToolProgressParsedLine {
  const header = line.match(/^(Wrote|Edited|Read|Deleted|Ran)\s+(.+)$/);
  if (header) {
    return {
      kind: "header",
      verb: header[1] as "Wrote" | "Edited" | "Read" | "Deleted" | "Ran",
      path: header[2] ?? "",
    };
  }
  const numberedDiff = line.match(/^(\d+)(\s+)([+-])(?:\s(.*))?$/);
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
