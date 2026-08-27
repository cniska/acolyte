import { isAbsolute, relative } from "node:path";
import { t } from "./i18n";
import type { ToolOutputPart } from "./tool-output-contract";
import { compactPatternLabels, type SearchSummaryStats, summarizeUnifiedDiff } from "./tool-output-parse";

export type ToolOutputListener = (event: {
  toolName: string;
  content: ToolOutputPart;
  toolCallId?: string;
  /** Output from a tool still running. Replaced by the parts emitted when it finishes. */
  transient?: boolean;
}) => void;

const TOOL_LABEL_KEYS: Record<string, string> = {
  "file-find": "tool.label.file_find",
  "file-search": "tool.label.file_search",
  "file-read": "tool.label.file_read",
  "file-edit": "tool.label.file_edit",
  "file-create": "tool.label.file_create",
  "file-delete": "tool.label.file_delete",
  "gh-pr-view": "tool.label.gh_pr_view",
  "gh-pr-create": "tool.label.gh_pr_create",
  "gh-pr-edit": "tool.label.gh_pr_edit",
  "gh-issue-create": "tool.label.gh_issue_create",
  "gh-issue-list": "tool.label.gh_issue_list",
  "git-status": "tool.label.git_status",
  "git-diff": "tool.label.git_diff",
  "git-log": "tool.label.git_log",
  "git-show": "tool.label.git_show",
  "git-add": "tool.label.git_add",
  "git-commit": "tool.label.git_commit",
  "shell-run": "tool.label.shell_run",
  "skill-activate": "tool.label.skill_activate",
  "skill-deactivate": "tool.label.skill_deactivate",
  "web-search": "tool.label.web_search",
  "web-fetch": "tool.label.web_fetch",
  "code-scan": "tool.label.code_scan",
  "code-edit": "tool.label.code_edit",
  "test-run": "tool.label.test_run",
  "memory-search": "tool.label.memory_search",
  "memory-add": "tool.label.memory_add",
  "memory-remove": "tool.label.memory_remove",
};

/**
 * Display text for a tool row. Not localized: the row's detail is always a path,
 * a command, or an identifier, and unmapped tools already render their raw English id,
 * so a translated label would show a seam the reader cannot account for.
 */
const TOOL_LABELS: Record<string, string> = {
  "tool.label.code_edit": "Edit (Code)",
  "tool.label.code_scan": "Scan Code",
  "tool.label.file_create": "Create",
  "tool.label.file_delete": "Delete",
  "tool.label.file_edit": "Edit",
  "tool.label.file_find": "Find",
  "tool.label.file_read": "Read",
  "tool.label.file_search": "Search",
  "tool.label.gh_issue_create": "Create Issue",
  "tool.label.gh_issue_list": "List Issues",
  "tool.label.gh_pr_create": "Create PR",
  "tool.label.gh_pr_edit": "Edit PR",
  "tool.label.gh_pr_view": "PR",
  "tool.label.git_add": "Git Add",
  "tool.label.git_commit": "Git Commit",
  "tool.label.git_diff": "Git Diff",
  "tool.label.git_log": "Git Log",
  "tool.label.git_show": "Git Show",
  "tool.label.git_status": "Git Status",
  "tool.label.memory_add": "Add (Memory)",
  "tool.label.memory_remove": "Remove (Memory)",
  "tool.label.memory_search": "Search (Memory)",
  "tool.label.shell_run": "Run",
  "tool.label.skill_activate": "Skill",
  "tool.label.skill_deactivate": "Skill",
  "tool.label.test_run": "Run (Test)",
  "tool.label.web_fetch": "Web Fetch",
  "tool.label.web_search": "Web Search",
};

/** Resolves a tool-header label id, falling back to the id for tools with no entry. */
export function resolveToolLabel(labelKey: string): string {
  return TOOL_LABELS[labelKey] ?? labelKey;
}
export function toolLabelKey(toolId: string): string {
  return TOOL_LABEL_KEYS[toolId] ?? toolId;
}

export function emitParts(
  parts: ToolOutputPart[],
  toolName: string,
  onOutput: ToolOutputListener,
  toolCallId?: string,
): void {
  for (const content of parts) onOutput({ toolName, content, toolCallId });
}

export function diffSummaryParts(path: string, rawResult: string, labelKey: string): ToolOutputPart[] {
  const { added, removed } = summarizeUnifiedDiff(rawResult);
  return [{ kind: "edit-header", labelKey, path, added, removed }];
}

/** The content a tool wrote, verbatim — indentation and blank lines are the content, so nothing
 *  here trims and nothing is left out: the transcript is the only record of what Acolyte changed. */
export function contentParts(content: string): ToolOutputPart[] {
  const body = content.replace(/\n$/, "");
  if (body.length === 0) return [];
  return body.split("\n").map((text, index) => ({ kind: "content", lineNumber: index + 1, text }) as ToolOutputPart);
}

function omittedLinesPart(count: number): ToolOutputPart {
  return { kind: "truncated", count, unit: "lines" };
}

export type ShellLine = { stream: "stdout" | "stderr"; text: string };

/** A command is read for how it ended: its first rows are the runner starting up, and the answer —
 *  a summary, a failure — is at the bottom. So a command's preview is a tail, headed by the count of
 *  what came before it. */
export function shellTailParts(lines: ShellLine[], tailRows: number): ToolOutputPart[] {
  if (lines.length === 0) return [{ kind: "no-output" }];
  const tail: ToolOutputPart[] = lines
    .slice(-tailRows)
    .map((entry) => ({ kind: "shell-output", stream: entry.stream, text: entry.text }));
  if (lines.length <= tailRows) return tail;
  return [omittedLinesPart(lines.length - tailRows), ...tail];
}

/** A listing, a log, or a diff is read from the top down, so its preview is a head and the count of
 *  what follows. Lines are kept verbatim: a status column and a diff's indentation are content. */
export function textHeadParts(rawText: string, headRows: number): ToolOutputPart[] {
  const body = rawText.replace(/\n$/, "");
  if (body.length === 0) return [{ kind: "no-output" }];
  const lines = body.split("\n");
  const head: ToolOutputPart[] = lines.slice(0, headRows).map((text) => ({ kind: "text", text }));
  if (lines.length <= headRows) return head;
  return [...head, omittedLinesPart(lines.length - headRows)];
}

export function findSummaryParts(filePaths: string[], patterns: string[], labelKey: string): ToolOutputPart[] {
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return [];
  const labels = compactPatternLabels(patterns);
  return [
    {
      kind: "scope-header",
      labelKey,
      scope: "workspace",
      patterns: labels,
      matches: unique.length,
      summary: t("unit.file", { count: unique.length }),
    },
  ];
}

export function webSearchSummary(result: string): string {
  const count = result.split("\n").filter((line) => /^\d+\.\s+\S/.test(line.trimEnd())).length;
  return t("unit.result", { count });
}

function toDisplayPath(path: string, workspace?: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("./")) return trimmed.slice(2);
  if (!workspace || !isAbsolute(trimmed)) return trimmed;
  const rel = relative(workspace, trimmed).replace(/\\/g, "/");
  if (rel.length === 0 || rel.startsWith("../")) return trimmed;
  return rel;
}

function normalizeScopeLabel(path: string): string {
  const trimmed = path.trim().replace(/^\.\/+/, "");
  if (trimmed.length === 0 || trimmed === ".") return "";
  if (trimmed.endsWith("/") || trimmed.includes("*")) return trimmed;
  const leaf = trimmed.split("/").at(-1) ?? trimmed;
  if (leaf.includes(".")) return trimmed;
  return `${trimmed}/`;
}

function uniquePaths(filePaths: string[]): string[] {
  return Array.from(new Set(filePaths.map((path) => path.trim()).filter((path) => path.length > 0)));
}

export function searchSummaryParts(
  stats: SearchSummaryStats,
  patterns: string[],
  paths: string[] | undefined,
  labelKey: string,
  workspace?: string,
): ToolOutputPart[] {
  if (stats.files === 0) return [];
  const labels = compactPatternLabels(patterns);
  const normalizedPaths = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  const scopeLabels = Array.from(
    new Set(normalizedPaths.map((path) => normalizeScopeLabel(toDisplayPath(path, workspace)))),
  );
  const effectiveLabels = scopeLabels.filter((label) => label.length > 0);
  let scope: string;
  if (effectiveLabels.length === 1) {
    scope = effectiveLabels[0] ?? "workspace";
  } else if (effectiveLabels.length > 1) {
    const shown = effectiveLabels.slice(0, 3).join(", ");
    const remaining = effectiveLabels.length - Math.min(effectiveLabels.length, 3);
    scope = remaining > 0 ? `${shown}, +${remaining}` : shown;
  } else {
    scope = "workspace";
  }
  return [
    {
      kind: "scope-header",
      labelKey,
      scope,
      patterns: labels,
      matches: stats.files,
      summary: `${t("unit.match", { count: stats.matches })} in ${t("unit.file", { count: stats.files })}`,
    },
  ];
}
