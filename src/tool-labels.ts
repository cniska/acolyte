const TOOL_LABELS: Record<string, string> = {
  "find-files": "Find",
  "search-files": "Search",
  "read-file": "Read",
  "git-status": "Status",
  "git-diff": "Diff",
  "run-command": "Run",
  "edit-file": "Edit",
  "edit-code": "Edit",
  "create-file": "Create",
  "delete-file": "Delete",
  "scan-code": "Scan",
  "web-search": "Search",
  "web-fetch": "Fetch",
};

export const TOOL_HEADER_VERBS = Object.values(TOOL_LABELS).filter(
  (value, index, self) => self.indexOf(value) === index,
);

function toTitleWords(input: string): string {
  return input
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatToolLabel(toolId: string): string {
  return TOOL_LABELS[toolId] ?? toTitleWords(toolId);
}
