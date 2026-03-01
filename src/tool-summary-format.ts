import { countLabel } from "./plural";
import { formatToolLabel } from "./tool-labels";
import type { ToolName } from "./tool-names";

const EMPTY_TOOL_PROGRESS_SUPPRESS = new Set(["find-files", "search-files", "read-file", "scan-code"]);
const SUMMARY_TOOL_NAMES = new Set<ToolName>(["find-files", "search-files", "read-file", "scan-code", "web-search"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactBracketList(value: string, maxItems = 3): string {
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (items.length <= maxItems) return `[${items.join(", ")}]`;
  const shown = items.slice(0, maxItems).join(", ");
  return `[${shown}, +${items.length - maxItems}]`;
}

export function formatToolFileSummaryHeader(toolName: string, fileCount: number): string {
  if (!SUMMARY_TOOL_NAMES.has(toolName as ToolName)) return countLabel(fileCount, "file", "files");
  const label = formatToolLabel(toolName);
  const count = countLabel(fileCount, "file", "files");
  return `${label} ${count}`;
}

export function mergeToolOutputHeader(header: string, toolName: string, line: string): string | null {
  const isSummaryTool = SUMMARY_TOOL_NAMES.has(toolName as ToolName);
  const label = formatToolLabel(toolName);
  if (!isSummaryTool && toolName !== "create-file" && toolName !== "edit-file" && toolName !== "edit-code")
    return null;
  const trimmed = line.trim();
  if (
    toolName === "find-files" &&
    new RegExp(`^scope=.+\\s+patterns=\\[[^\\]]*\\]\\s+matches=\\d+$`, "i").test(trimmed)
  )
    return `${label} ${trimmed}`;
  if (
    toolName === "search-files" &&
    new RegExp(`^scope=.+\\s+patterns=\\[[^\\]]*\\]\\s+matches=\\d+$`, "i").test(trimmed)
  ) {
    const match = trimmed.match(/^scope=(.+)\s+patterns=\[([^\]]*)\]\s+matches=\d+$/i);
    if (!match?.[1]) return `${label} ${trimmed}`;
    const scope = match[1].trim();
    const patterns = compactBracketList(match[2] ?? "");
    if (scope === "workspace") return `${label} ${patterns}`;
    return `${label} ${scope} ${patterns}`;
  }
  if (toolName === "web-search") {
    const match = trimmed.match(/^query=("(?:\\.|[^"])*")\s+results=(\d+)$/i);
    if (match?.[1]) {
      const quoted = match[1];
      return `${label} ${quoted}`;
    }
  }
  if (
    (toolName === "read-file" || toolName === "scan-code") &&
    new RegExp(`^paths=\\d+\\s+targets=\\[[^\\]]*\\](?:\\s+omitted=\\d+)?$`, "i").test(trimmed)
  ) {
    const match = trimmed.match(/^paths=(\d+)\s+targets=\[([^\]]*)\](?:\s+omitted=(\d+))?$/i);
    if (!match) return `${label} ${trimmed}`;
    const targets = (match[2] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const omitted = Number.parseInt(match[3] ?? "0", 10);
    if (targets.length === 0) return `${label}`;
    const list = targets.join(", ");
    if (Number.isFinite(omitted) && omitted > 0) return `${label} ${list}, +${omitted}`;
    return `${label} ${list}`;
  }
  if (
    toolName === "create-file" &&
    /^path=.+\s+files=\d+$/i.test(trimmed)
  )
    return `Create ${trimmed}`;
  if (
    (toolName === "edit-file" || toolName === "edit-code") &&
    /^path=.+\s+files=\d+\s+added=\d+\s+removed=\d+$/i.test(trimmed)
  )
    return `Edit ${trimmed}`;
  if (toolName === "find-files" && new RegExp(`^${escapeRegExp(label)}(?:\\s+.+)?\\s+using\\s+.+$`, "i").test(trimmed))
    return trimmed;
  if (toolName === "search-files" && new RegExp(`^${escapeRegExp(label)}(?:\\s+.+)?\\s+using\\s+.+$`, "i").test(trimmed))
    return trimmed;
  if ((toolName === "read-file" || toolName === "scan-code") && new RegExp(`^${escapeRegExp(label)}\\s+.+$`, "i").test(trimmed))
    return trimmed;
  if (/^\d+\s+files?\b/i.test(trimmed)) return `${label} ${trimmed}`;
  if (new RegExp(`^${escapeRegExp(label)}\\b.*\\b\\d+\\s+files?\\b`, "i").test(trimmed)) return trimmed;
  if (new RegExp(`^${escapeRegExp(label)}\\s+\\d+\\s+files?\\b`, "i").test(trimmed)) return trimmed;
  if (new RegExp(`^${escapeRegExp(header)}\\s+\\d+\\s+files?\\b`, "i").test(trimmed)) return trimmed;
  return null;
}

export function shouldSuppressEmptyToolProgressRow(toolName: string): boolean {
  return EMPTY_TOOL_PROGRESS_SUPPRESS.has(toolName);
}
