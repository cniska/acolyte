import { countLabel } from "./plural";
import { formatToolLabel } from "./tool-labels";
import type { ToolName } from "./tool-names";
import { parseToolOutputRow } from "./tool-output-parser";

const EMPTY_TOOL_PROGRESS_SUPPRESS = new Set(["find-files", "search-files", "read-file", "scan-code"]);
const SUMMARY_TOOL_NAMES = new Set<ToolName>(["find-files", "search-files", "read-file", "scan-code", "web-search"]);

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
  if (!SUMMARY_TOOL_NAMES.has(toolName as ToolName)) return countLabel(fileCount, "file", "files");
  const label = formatToolLabel(toolName);
  const count = countLabel(fileCount, "file", "files");
  return `${label} ${count}`;
}

export function mergeToolOutputHeader(_header: string, toolName: string, line: string): string | null {
  const isSummaryTool = SUMMARY_TOOL_NAMES.has(toolName as ToolName);
  const label = formatToolLabel(toolName);
  if (!isSummaryTool && toolName !== "create-file" && toolName !== "edit-file" && toolName !== "edit-code") return null;
  const trimmed = line.trim();
  const parsed = parseToolOutputRow(toolName, trimmed);
  if (parsed.kind === "find-summary") {
    const patterns = compactList(parsed.patterns.join(", "));
    if (parsed.scope === "workspace") return `${label} ${patterns}`;
    return `${label} ${parsed.scope} ${patterns}`;
  }
  if (parsed.kind === "search-summary") {
    const patterns = compactBracketList(parsed.patterns.join(", "));
    if (parsed.scope === "workspace") return `${label} ${patterns}`;
    return `${label} ${parsed.scope} ${patterns}`;
  }
  if (parsed.kind === "web-search-summary") return `${label} ${parsed.query}`;
  if (parsed.kind === "read-summary") {
    if (parsed.targets.length === 0) return `${label}`;
    const list = parsed.targets.join(", ");
    if (parsed.omitted > 0) return `${label} ${list}, +${parsed.omitted}`;
    return `${label} ${list}`;
  }
  if (parsed.kind === "create-summary") return `Create path=${parsed.path} files=${parsed.files}`;
  if (parsed.kind === "edit-summary")
    return `Edit path=${parsed.path} files=${parsed.files} added=${parsed.added} removed=${parsed.removed}`;
  if (parsed.kind === "files-count") return `${label} ${parsed.files} ${parsed.files === 1 ? "file" : "files"}`;
  return null;
}

export function shouldSuppressEmptyToolProgressRow(toolName: string): boolean {
  return EMPTY_TOOL_PROGRESS_SUPPRESS.has(toolName);
}
