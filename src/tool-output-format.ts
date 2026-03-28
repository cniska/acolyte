import { isAbsolute, relative } from "node:path";
import { t } from "./i18n";
import type { ToolOutputPart } from "./tool-output-content";
import { compactPatternLabels, summarizeUnifiedDiff, type SearchSummaryEntry } from "./tool-output-parse";

export type ToolOutputListener = (event: { toolName: string; content: ToolOutputPart; toolCallId?: string }) => void;

export function emitParts(
  parts: ToolOutputPart[],
  toolName: string,
  onOutput: ToolOutputListener,
  toolCallId?: string,
): void {
  for (const content of parts) onOutput({ toolName, content, toolCallId });
}

export const TOOL_OUTPUT_LIMITS = {
  files: 5,
  inlineFiles: 3,
  run: 5,
  read: 48,
  diff: 64,
  status: 6,
} as const;

export function diffSummaryParts(path: string, rawResult: string, labelKey: string): ToolOutputPart[] {
  const { files, added, removed } = summarizeUnifiedDiff(rawResult);
  const touchedFiles = files > 0 ? files : 1;
  const displayPath = touchedFiles > 1 ? t("unit.file", { count: touchedFiles }) : path;
  return [{ kind: "edit-header", labelKey, path: displayPath, files: touchedFiles, added, removed }];
}

function mapHeadTailParts<T>(
  items: T[],
  toPart: (item: T) => ToolOutputPart,
  omittedPart: (count: number) => ToolOutputPart,
  headRows: number,
  tailRows: number,
): ToolOutputPart[] {
  if (items.length === 0) return [{ kind: "no-output" }];
  if (items.length > headRows + tailRows) {
    return [
      ...items.slice(0, headRows).map(toPart),
      omittedPart(items.length - (headRows + tailRows)),
      ...items.slice(-tailRows).map(toPart),
    ];
  }
  return items.map(toPart);
}

function omittedLinesPart(count: number): ToolOutputPart {
  return { kind: "text", text: `⋮ +${t("unit.line", { count })}` };
}

export type ShellLine = { stream: "stdout" | "stderr"; text: string };

// Keep thin domain wrappers so toolkit call sites deal in native inputs,
// while the head/tail implementation stays single-sourced.
export function shellHeadTailParts(
  lines: ShellLine[],
  options?: { headRows?: number; tailRows?: number },
): ToolOutputPart[] {
  return mapHeadTailParts(
    lines,
    (entry) => ({ kind: "shell-output", stream: entry.stream, text: entry.text }),
    omittedLinesPart,
    options?.headRows ?? 2,
    options?.tailRows ?? 2,
  );
}

export function textHeadTailParts(
  rawText: string,
  options?: { headRows?: number; tailRows?: number },
): ToolOutputPart[] {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return mapHeadTailParts(
    lines,
    (line) => ({ kind: "text", text: line }),
    omittedLinesPart,
    options?.headRows ?? 2,
    options?.tailRows ?? 2,
  );
}

export function resultChunkParts(result: string, maxLines = 80): ToolOutputPart[] {
  const allLines = result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parts: ToolOutputPart[] = allLines.slice(0, maxLines).map((text) => ({ kind: "text", text }));
  if (allLines.length > maxLines) {
    parts.push({ kind: "truncated", count: allLines.length - maxLines, unit: "lines" });
  }
  return parts;
}

export function fileListSummaryParts(
  filePaths: string[],
  maxFiles = TOOL_OUTPUT_LIMITS.files,
  workspace?: string,
): ToolOutputPart[] {
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return [];
  const parts: ToolOutputPart[] = [{ kind: "text", text: `files=${unique.length}` }];
  for (const path of unique.slice(0, maxFiles)) {
    parts.push({ kind: "text", text: toDisplayPath(path, workspace) });
  }
  if (unique.length > maxFiles) {
    parts.push({ kind: "truncated", count: unique.length - maxFiles, unit: "matches" });
  }
  return parts;
}

export function findSummaryParts(filePaths: string[], patterns: string[], labelKey: string): ToolOutputPart[] {
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return [];
  const labels = compactPatternLabels(patterns);
  return [
    { kind: "scope-header", labelKey, scope: "workspace", patterns: labels, matches: unique.length },
    { kind: "text", text: t("unit.file", { count: unique.length }) },
  ];
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
  entries: SearchSummaryEntry[],
  patterns: string[],
  paths: string[] | undefined,
  labelKey: string,
  workspace?: string,
): ToolOutputPart[] {
  const filePaths = entries.map((entry) => entry.path);
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return [];
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
  const totalHits = entries.reduce((sum, e) => sum + e.hits.length, 0);
  return [
    { kind: "scope-header", labelKey, scope, patterns: labels, matches: unique.length },
    { kind: "text", text: `${t("unit.match", { count: totalHits })} in ${t("unit.file", { count: unique.length })}` },
  ];
}
