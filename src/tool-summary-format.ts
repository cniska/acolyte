import { countLabel } from "./plural";

const FILE_SUMMARY_TOOL_LABELS: Record<string, string> = {
  "find-files": "Find",
  "search-files": "Search",
  "read-file": "Read",
  "scan-code": "Review",
};
const EMPTY_TOOL_PROGRESS_SUPPRESS = new Set(["find-files", "search-files", "read-file", "scan-code"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatToolFileSummaryHeader(toolName: string, fileCount: number): string {
  const label = FILE_SUMMARY_TOOL_LABELS[toolName];
  const count = countLabel(fileCount, "file", "files");
  if (!label) return count;
  return `${label} ${count}`;
}

export function normalizeToolFileSummaryHeader(header: string, toolName: string, line: string): string | null {
  const label = FILE_SUMMARY_TOOL_LABELS[toolName];
  if (!label) return null;
  const trimmed = line.trim();
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
