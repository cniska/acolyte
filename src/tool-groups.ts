import type { ToolName } from "./tool-names";

export const WRITE_TOOLS: readonly ToolName[] = ["edit-code", "edit-file", "create-file", "delete-file"];
export const READ_TOOLS: readonly ToolName[] = ["read-file"];
export const SEARCH_TOOLS: readonly ToolName[] = [
  "find-files",
  "search-files",
  "scan-code",
  "git-status",
  "git-diff",
  "git-log",
  "git-show",
];
export const DISCOVERY_TOOLS: readonly ToolName[] = [
  "find-files",
  "search-files",
  "read-file",
  "scan-code",
  "git-status",
  "git-diff",
  "git-log",
  "git-show",
];

export const WRITE_TOOL_SET = new Set<ToolName>(WRITE_TOOLS);
export const READ_TOOL_SET = new Set<ToolName>(READ_TOOLS);
export const SEARCH_TOOL_SET = new Set<ToolName>(SEARCH_TOOLS);
export const DISCOVERY_TOOL_SET = new Set<ToolName>(DISCOVERY_TOOLS);
