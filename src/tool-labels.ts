const TOOL_LABELS: Record<string, string> = {
  "find-files": "Find",
  "search-files": "Search",
  "read-file": "Read",
  "git-status": "Status",
  "git-diff": "Diff",
  "run-command": "Run",
  "edit-file": "Edit",
  "write-file": "Write",
  "delete-file": "Delete",
  "web-search": "Search",
  "web-fetch": "Fetch",
};

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
