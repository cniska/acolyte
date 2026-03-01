export const TOOL_NAMES = [
  "find-files",
  "search-files",
  "scan-code",
  "read-file",
  "git-status",
  "git-diff",
  "git-log",
  "run-command",
  "edit-code",
  "edit-file",
  "create-file",
  "delete-file",
  "web-search",
  "web-fetch",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

export function isToolName(value: string): value is ToolName {
  return TOOL_NAME_SET.has(value);
}
