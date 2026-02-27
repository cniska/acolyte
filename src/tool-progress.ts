export type ToolProgressParsedLine =
  | { kind: "header"; verb: string; path: string }
  | { kind: "numberedDiff"; lineNumber: string; spacing: string; marker: "+" | "-"; text: string }
  | { kind: "numberedContext"; lineNumber: string; spacing: string; text: string }
  | { kind: "fileDiff"; marker: "+" | "-"; text: string }
  | { kind: "commandOutput"; stream: "out" | "err"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "text"; text: string };

export type ToolOutputKind = "diff" | "command" | "plain";

export type ToolProgressBlock = {
  kind: ToolOutputKind;
  header: { verb: string; path: string } | null;
  lines: ToolProgressParsedLine[];
  lineNumberWidth: number;
};

import { TOOL_HEADER_VERBS } from "./tool-labels";

const HEADER_PATTERN = new RegExp(`^(${TOOL_HEADER_VERBS.join("|")})\\s+(.+)$`);

function outputKindFromVerb(verb: string): ToolOutputKind {
  switch (verb) {
    case "Edit":
    case "Create":
      return "diff";
    case "Run":
      return "command";
    default:
      return "plain";
  }
}

export function parseToolProgressBlock(content: string): ToolProgressBlock {
  const allLines = content.split("\n");
  const parsed = allLines.map(parseToolProgressLine);
  const first = parsed[0];
  const header = first?.kind === "header" ? { verb: first.verb, path: first.path } : null;
  const lines = header ? parsed.slice(1) : parsed;
  const kind = header ? outputKindFromVerb(header.verb) : "plain";
  const lineNumberWidth = Math.max(
    3,
    lines.reduce((max, line) => {
      if (line.kind === "numberedDiff" || line.kind === "numberedContext") return Math.max(max, line.lineNumber.length);
      return max;
    }, 0),
  );
  return { kind, header, lines, lineNumberWidth };
}

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
  const numberedContext = line.match(/^(\d+)(\s{2})(.*)$/);
  if (numberedContext) {
    return {
      kind: "numberedContext",
      lineNumber: numberedContext[1] ?? "",
      spacing: numberedContext[2] ?? "  ",
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
  if (line.startsWith("+ ")) return { kind: "fileDiff", marker: "+", text: line };
  if (line.startsWith("- ")) return { kind: "fileDiff", marker: "-", text: line };
  if (line === "…" || (/^[…(]/.test(line) && /truncat|omit|output|lines$/i.test(line)))
    return { kind: "meta", text: line };
  return { kind: "text", text: line };
}
