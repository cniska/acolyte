export type ToolProgressParsedLine =
  | { kind: "header"; verb: string; path: string }
  | { kind: "numberedDiff"; lineNumber: string; spacing: string; marker: "+" | "-"; text: string }
  | { kind: "numberedContext"; lineNumber: string; spacing: string; text: string }
  | { kind: "plainDiff"; marker: "+" | "-"; text: string }
  | { kind: "commandOutput"; stream: "out" | "err"; text: string }
  | { kind: "text"; text: string };

import { TOOL_HEADER_VERBS } from "./tool-labels";

const HEADER_PATTERN = new RegExp(`^(${TOOL_HEADER_VERBS.join("|")})\\s+(.+)$`);

export function parseToolProgressLine(line: string): ToolProgressParsedLine {
  const header = line.match(HEADER_PATTERN);
  if (header) {
    return {
      kind: "header",
      verb: header[1] ?? "",
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
  const commandOutput = line.match(/^(out|err) \| (.*)$/);
  if (commandOutput) {
    return {
      kind: "commandOutput",
      stream: commandOutput[1] as "out" | "err",
      text: commandOutput[2] ?? "",
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
