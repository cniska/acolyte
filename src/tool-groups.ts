import { writeToolIds } from "./tool-registry";

export const WRITE_TOOLS: readonly string[] = writeToolIds();
export const READ_TOOLS: readonly string[] = ["read-file"];
export const SEARCH_TOOLS: readonly string[] = [
  "find-files",
  "search-files",
  "scan-code",
  "git-status",
  "git-diff",
  "git-log",
  "git-show",
];
export const DISCOVERY_TOOLS: readonly string[] = [
  "find-files",
  "search-files",
  "read-file",
  "scan-code",
  "git-status",
  "git-diff",
  "git-log",
  "git-show",
];

export const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS);
export const READ_TOOL_SET = new Set<string>(READ_TOOLS);
export const SEARCH_TOOL_SET = new Set<string>(SEARCH_TOOLS);
export const DISCOVERY_TOOL_SET = new Set<string>(DISCOVERY_TOOLS);
