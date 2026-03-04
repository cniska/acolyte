import { unreachable } from "./assert";
import { countLabel } from "./plural";
import { formatToolLabel } from "./tool-labels";
import type { ToolName } from "./tool-names";
import { parseToolOutputRow } from "./tool-output-parser";

const EMPTY_TOOL_PROGRESS_SUPPRESS = new Set(["find-files", "search-files", "read-file", "scan-code"]);
const MERGEABLE_TOOL_NAMES = new Set<ToolName>([
  "find-files",
  "search-files",
  "read-file",
  "scan-code",
  "web-search",
  "create-file",
  "edit-file",
  "edit-code",
]);
const SUMMARY_HEADER_TOOL_NAMES = new Set<ToolName>([
  "find-files",
  "search-files",
  "read-file",
  "scan-code",
  "web-search",
]);

function compactBracketList(value: string, maxItems = 3): string {
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (items.length <= maxItems) return `[${items.join(", ")}]`;
  const shown = items.slice(0, maxItems).join(", ");
  return `[${shown}, +${items.length - maxItems}]`;
}

function compactList(value: string, maxItems = 3): string {
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (items.length <= maxItems) return items.join(", ");
  const shown = items.slice(0, maxItems).join(", ");
  return `${shown}, +${items.length - maxItems}`;
}

export function formatToolFileSummaryHeader(toolName: string, fileCount: number): string {
  if (!SUMMARY_HEADER_TOOL_NAMES.has(toolName as ToolName)) return countLabel(fileCount, "file", "files");
  const label = formatToolLabel(toolName);
  const count = countLabel(fileCount, "file", "files");
  return `${label} ${count}`;
}

export function mergeToolOutputHeader(_header: string, toolName: string, line: string): string | null {
  const isMergeableTool = MERGEABLE_TOOL_NAMES.has(toolName as ToolName);
  const label = formatToolLabel(toolName);
  if (!isMergeableTool) return null;
  const trimmed = line.trim();
  const parsed = parseToolOutputRow(toolName, trimmed);
  switch (parsed.kind) {
    case "find-summary": {
      const patterns = compactList(parsed.patterns.join(", "));
      if (parsed.scope === "workspace") return `${label} ${patterns}`;
      return `${label} ${parsed.scope} ${patterns}`;
    }
    case "search-summary": {
      const patterns = compactBracketList(parsed.patterns.join(", "));
      if (parsed.scope === "workspace") return `${label} ${patterns}`;
      return `${label} ${parsed.scope} ${patterns}`;
    }
    case "web-search-summary":
      return `${label} ${parsed.query}`;
    case "read-summary": {
      if (parsed.targets.length === 0) return `${label}`;
      const list = parsed.targets.join(", ");
      if (parsed.omitted > 0) return `${label} ${list}, +${parsed.omitted}`;
      return `${label} ${list}`;
    }
    case "create-summary":
      return `Create ${parsed.path}`;
    case "edit-summary":
      return `Edit path=${parsed.path} files=${parsed.files} added=${parsed.added} removed=${parsed.removed}`;
    case "files-count":
      return `${label} ${parsed.files} ${parsed.files === 1 ? "file" : "files"}`;
    case "unknown":
      return null;
    default:
      return unreachable(parsed);
  }
}

export function shouldSuppressEmptyToolProgressRow(toolName: string): boolean {
  return EMPTY_TOOL_PROGRESS_SUPPRESS.has(toolName);
}
