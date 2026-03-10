import { relative } from "node:path";
import { z } from "zod";
import { wrapAssistantContent } from "./chat-content";
import { truncateText } from "./compact-text";
import { t } from "./i18n";
import { formatToolOutput, type ToolOutput } from "./tool-output-content";
import { TOOL_OUTPUT_LIMITS } from "./tool-output-format";
import { printDim, printToolHeader } from "./ui";

export { truncateText };

const editResultSchema = z.object({
  path: z.string().min(1),
  edits: z.coerce.number().int().nonnegative(),
  dryRun: z.boolean(),
});

const runExitCodeSchema = z.coerce.number().int();

export function displayPath(pathInput: string): string {
  const rel = relative(process.cwd(), pathInput);
  if (!rel || rel.startsWith("..")) return pathInput;
  return rel;
}

export function printIndentedDim(content: string): void {
  for (const line of content.split("\n")) {
    printDim(line.length > 0 ? `  ${line}` : "");
  }
}

export function printToolOutput(label: string, content: string, detail?: string): void {
  const items: ToolOutput[] = [{ kind: "tool-header", label, detail }];
  if (content.length === 0) {
    items.push({ kind: "no-output" });
  } else {
    for (const line of content.split("\n")) {
      const trimmed = line.trimEnd();
      if (trimmed.length > 0) items.push({ kind: "text", text: trimmed });
    }
  }
  const rendered = formatToolOutput(items);
  const lines = rendered.split("\n");
  // First line is the header (bold title + dim detail), rest are dim body
  if (lines[0]) printToolHeader(label, detail);
  for (const line of lines.slice(1)) {
    printDim(line);
  }
}

export function clampLines(lines: string[], maxLines: number, overflowTolerance = 4): string[] {
  if (lines.length <= maxLines + overflowTolerance) return lines;
  return [...lines.slice(0, maxLines - 1), `… +${t("unit.line", { count: lines.length - (maxLines - 1) })}`];
}

export function formatFindOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return t("tool.content.no_matches");
  return clampLines(lines, TOOL_OUTPUT_LIMITS.files).join("\n");
}

export function formatSearchOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0 || (lines.length === 1 && lines[0].toLowerCase().startsWith("no matches")))
    return t("tool.content.no_matches");
  return clampLines(lines, TOOL_OUTPUT_LIMITS.files).join("\n");
}

export function formatReadOutput(raw: string): string {
  const lines = raw.split("\n");
  const normalized = [...lines];
  if (normalized[0]?.startsWith("File: ")) {
    const rawPath = normalized[0].slice("File: ".length).trim();
    normalized[0] = `File: ${displayPath(rawPath)}`;
  }
  return clampLines(normalized, TOOL_OUTPUT_LIMITS.read).join("\n");
}

export function formatDiffOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  return clampLines(lines, TOOL_OUTPUT_LIMITS.diff).join("\n");
}

export function formatGitStatusOutput(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return t("tool.content.working_tree_clean");
  return clampLines(lines, TOOL_OUTPUT_LIMITS.status).join("\n");
}

export function formatRunOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length === 0) return t("tool.content.no_output");

  const exitCode = Number.parseInt((lines[0] ?? "").replace("exit_code=", "").trim(), 10);
  const stdoutIdx = lines.findIndex((line) => line.trim() === "stdout:");
  const stderrIdx = lines.findIndex((line) => line.trim() === "stderr:");
  const out: string[] = [];

  const section = (name: "stdout:" | "stderr:", start: number, end: number): void => {
    if (start < 0) return;
    let payload = lines.slice(start + 1, end).filter((line) => line.trim().length > 0);
    if (name === "stderr:" && exitCode === 0 && stdoutIdx >= 0) payload = [];
    if (payload.length === 0) return;
    out.push(...clampLines(payload, TOOL_OUTPUT_LIMITS.run));
  };

  const nextAfterStdout = stderrIdx >= 0 ? stderrIdx : lines.length;
  section("stdout:", stdoutIdx, nextAfterStdout);
  section("stderr:", stderrIdx, lines.length);

  if (out.length === 0) return t("tool.content.no_output");
  return out.join("\n");
}

export function parseRunExitCode(raw: string): number | null {
  const first = raw.split("\n")[0]?.trim() ?? "";
  if (!first.startsWith("exit_code=")) return null;
  const parsed = runExitCodeSchema.safeParse(first.slice("exit_code=".length));
  return parsed.success ? parsed.data : null;
}

export function formatForTool(kind: "find" | "search" | "read" | "diff" | "run" | "status", raw: string): string {
  if (kind === "find") return formatFindOutput(raw);
  if (kind === "search") return formatSearchOutput(raw);
  if (kind === "read") return formatReadOutput(raw);
  if (kind === "diff") return formatDiffOutput(raw);
  if (kind === "run") return formatRunOutput(raw);
  return formatGitStatusOutput(raw);
}

export function summarizeDiff(raw: string): {
  added: number;
  removed: number;
  locations: number;
  preview: string[];
} {
  const preview: string[] = [];
  let added = 0;
  let removed = 0;
  let locations = 0;
  const lines = raw.split("\n");
  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@ ")) {
      locations += 1;
      preview.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }

  // Build a compact hunk-centered preview with one context line around edits.
  let currentHunkHeader = "";
  let currentHunkBody: string[] = [];
  const excerpt: string[] = [];
  const flushHunk = (): void => {
    if (!currentHunkHeader) return;
    const changedIdxs = currentHunkBody
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.startsWith("+") || entry.line.startsWith("-"))
      .map((entry) => entry.index);
    if (changedIdxs.length === 0) {
      currentHunkHeader = "";
      currentHunkBody = [];
      return;
    }
    const include = new Set<number>();
    for (const idx of changedIdxs) {
      include.add(idx - 1);
      include.add(idx);
      include.add(idx + 1);
    }
    excerpt.push(currentHunkHeader);
    for (let i = 0; i < currentHunkBody.length; i += 1) {
      if (!include.has(i)) continue;
      const line = currentHunkBody[i];
      if (line === undefined) continue;
      excerpt.push(line);
    }
    currentHunkHeader = "";
    currentHunkBody = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunkHeader = line;
      currentHunkBody = [];
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!currentHunkHeader) continue;
    currentHunkBody.push(line);
  }
  flushHunk();

  return { added, removed, locations, preview: clampLines(excerpt, 18) };
}

export function formatEditUpdateOutput(matches: number, diff: string): string {
  const summary = summarizeDiff(diff);
  const lines = [
    `${t("unit.replacement", { count: matches })} applied.`,
    `${t("unit.location", { count: summary.locations })} updated.`,
    `Added ${t("unit.line", { count: summary.added })}, removed ${t("unit.line", { count: summary.removed })}.`,
  ];
  if (summary.preview.length > 0) {
    lines.push("Preview:");
    lines.push(...summary.preview);
  } else {
    lines.push("No diff preview available (file may be untracked or unchanged in git).");
  }
  return lines.join("\n");
}

export function formatReadDetail(pathInput: string, start?: string, end?: string): string {
  if (!start && !end) return pathInput;
  const from = start ?? "1";
  const to = end ?? "EOF";
  return `${pathInput}:${from}-${to}`;
}

export function formatAssistantReplyOutput(content: string, wrapWidth = 100): string {
  const wrapped = wrapAssistantContent(content, wrapWidth);
  const lines = wrapped.split("\n");
  if (lines.length === 0) return "•";
  return lines
    .map((line, index) => {
      if (index === 0) return line.length > 0 ? `• ${line}` : "•";
      return line.length > 0 ? `  ${line}` : "";
    })
    .join("\n");
}

export function parseEditResult(raw: string): { path: string; edits: number; dryRun: boolean } | null {
  const path = raw.match(/^path=(.*)$/m)?.[1]?.trim();
  const editsText = raw.match(/^edits=(.*)$/m)?.[1]?.trim();
  const dryRunText = raw.match(/^dry_run=(.*)$/m)?.[1]?.trim();
  if (!path || !editsText || !dryRunText) return null;
  if (dryRunText !== "true" && dryRunText !== "false") return null;
  const parsed = editResultSchema.safeParse({
    path,
    edits: editsText,
    dryRun: dryRunText === "true",
  });
  return parsed.success ? parsed.data : null;
}
