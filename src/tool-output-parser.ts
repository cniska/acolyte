import type { ToolName } from "./tool-names";

export const TOOL_OUTPUT_MARKERS = {
  truncated: "[truncated]",
  noOutput: "[no-output]",
} as const;

export type ToolOutputMarker =
  | { kind: "none" }
  | { kind: "no-output" }
  | { kind: "truncated"; count: number; unit?: string };

export type ParsedToolOutputRow =
  | { kind: "unknown" }
  | { kind: "files-count"; files: number }
  | { kind: "find-summary"; scope: string; patterns: string[]; matches: number }
  | { kind: "search-summary"; scope: string; patterns: string[]; matches: number }
  | { kind: "read-summary"; paths: number; targets: string[]; omitted: number }
  | { kind: "web-search-summary"; query: string; results: number }
  | { kind: "create-summary"; path: string; files: number }
  | { kind: "edit-summary"; path: string; files: number; added: number; removed: number };

export interface ToolOutputParser {
  parseRow(toolName: string, line: string): ParsedToolOutputRow;
  parseMarker(line: string): ToolOutputMarker;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export class TextToolOutputParser implements ToolOutputParser {
  parseRow(toolName: string, line: string): ParsedToolOutputRow {
    const trimmed = line.trim();
    const filesCountMatch = trimmed.match(/^(\d+)\s+files?$/i);
    if (filesCountMatch?.[1]) return { kind: "files-count", files: Number.parseInt(filesCountMatch[1], 10) };
    if (toolName === "find-files") {
      const match = trimmed.match(/^scope=(.+)\s+patterns=\[([^\]]*)\]\s+matches=(\d+)$/i);
      if (match?.[1] && match[2] != null && match[3]) {
        return {
          kind: "find-summary",
          scope: match[1].trim(),
          patterns: splitList(match[2]),
          matches: Number.parseInt(match[3], 10),
        };
      }
      return { kind: "unknown" };
    }
    if (toolName === "search-files") {
      const match = trimmed.match(/^scope=(.+)\s+patterns=\[([^\]]*)\]\s+matches=(\d+)$/i);
      if (match?.[1] && match[2] != null && match[3]) {
        return {
          kind: "search-summary",
          scope: match[1].trim(),
          patterns: splitList(match[2]),
          matches: Number.parseInt(match[3], 10),
        };
      }
      return { kind: "unknown" };
    }
    if (toolName === "read-file" || toolName === "scan-code") {
      const match = trimmed.match(/^paths=(\d+)\s+targets=\[([^\]]*)\](?:\s+omitted=(\d+))?$/i);
      if (match?.[1] && match[2] != null) {
        return {
          kind: "read-summary",
          paths: Number.parseInt(match[1], 10),
          targets: splitList(match[2]),
          omitted: Number.parseInt(match[3] ?? "0", 10),
        };
      }
      return { kind: "unknown" };
    }
    if (toolName === "web-search") {
      const match = trimmed.match(/^query=("(?:\\.|[^"])*")\s+results=(\d+)$/i);
      if (match?.[1] && match[2]) {
        return {
          kind: "web-search-summary",
          query: match[1],
          results: Number.parseInt(match[2], 10),
        };
      }
      return { kind: "unknown" };
    }
    if (toolName === "create-file") {
      const match = trimmed.match(/^path=(.+)\s+files=(\d+)$/i);
      if (match?.[1] && match[2]) {
        return {
          kind: "create-summary",
          path: match[1].trim(),
          files: Number.parseInt(match[2], 10),
        };
      }
      return { kind: "unknown" };
    }
    if (toolName === "edit-file" || toolName === "edit-code") {
      const match = trimmed.match(/^path=(.+)\s+files=(\d+)\s+added=(\d+)\s+removed=(\d+)$/i);
      if (match?.[1] && match[2] && match[3] && match[4]) {
        return {
          kind: "edit-summary",
          path: match[1].trim(),
          files: Number.parseInt(match[2], 10),
          added: Number.parseInt(match[3], 10),
          removed: Number.parseInt(match[4], 10),
        };
      }
      return { kind: "unknown" };
    }
    return { kind: "unknown" };
  }

  parseMarker(line: string): ToolOutputMarker {
    const trimmed = line.trim();
    if (trimmed === TOOL_OUTPUT_MARKERS.noOutput) return { kind: "no-output" };
    if (trimmed === TOOL_OUTPUT_MARKERS.truncated) return { kind: "truncated", count: 0 };
    const match = trimmed.match(/^\[truncated\]\s+\+(\d+)(?:\s+(.+))?$/);
    if (match?.[1]) {
      const count = Number.parseInt(match[1], 10);
      return { kind: "truncated", count, unit: match[2]?.trim() || undefined };
    }
    return { kind: "none" };
  }
}

const defaultParser = new TextToolOutputParser();

export function parseToolOutputRow(toolName: ToolName | string, line: string): ParsedToolOutputRow {
  return defaultParser.parseRow(toolName, line);
}

export function parseToolOutputMarker(line: string): ToolOutputMarker {
  return defaultParser.parseMarker(line);
}
