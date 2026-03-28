import { isAbsolute, relative } from "node:path";
import { t } from "./i18n";
import type { ToolOutputPart } from "./tool-output-content";

export type ToolOutputListener = (event: { toolName: string; content: ToolOutputPart; toolCallId?: string }) => void;

export function emitParts(
  parts: ToolOutputPart[],
  toolName: string,
  onOutput: ToolOutputListener,
  toolCallId?: string,
): void {
  for (const content of parts) onOutput({ toolName, content, toolCallId });
}

export type UnifiedDiffSummary = {
  files: number;
  added: number;
  removed: number;
};

export const TOOL_OUTPUT_LIMITS = {
  files: 5,
  inlineFiles: 3,
  run: 5,
  read: 48,
  diff: 64,
  status: 6,
} as const;

export function summarizeUnifiedDiff(rawResult: string): UnifiedDiffSummary {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const line of rawResult.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }
  return { files, added, removed };
}

export function diffSummaryParts(path: string, rawResult: string, labelKey: string): ToolOutputPart[] {
  const { files, added, removed } = summarizeUnifiedDiff(rawResult);
  const touchedFiles = files > 0 ? files : 1;
  const displayPath = touchedFiles > 1 ? t("unit.file", { count: touchedFiles }) : path;
  return [{ kind: "edit-header", labelKey, path: displayPath, files: touchedFiles, added, removed }];
}

function headTailParts<T>(
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

export function shellHeadTailParts(
  lines: ShellLine[],
  options?: { headRows?: number; tailRows?: number },
): ToolOutputPart[] {
  return headTailParts(
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
  return headTailParts(
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

export function findResultPaths(result: string): string[] {
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("./"));
}

function asSearchRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function compactPatternLabel(pattern: string): string {
  const trimmed = pattern.trim();
  const boundaryMatch = trimmed.match(/^\\b(.+)\\b$/);
  const core = boundaryMatch?.[1]?.trim() ?? trimmed;
  const unquoted = core.replace(/^["'`](.+)["'`]$/, "$1");
  return escapeControlChars(truncateValue(unquoted, 32));
}

function compactPatternLabels(patterns: string[]): string[] {
  const labels = patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => compactPatternLabel(pattern))
    .filter((label) => label.length > 0);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(label);
  }
  return deduped;
}

export type SearchSummaryEntry = {
  path: string;
  hits: string[];
};

export function searchResultSummaryEntries(result: string, patterns: string[]): SearchSummaryEntry[] {
  const normalized = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
  const regexes = normalized.map((pattern) => asSearchRegex(pattern));
  const labels = normalized.map((pattern) => compactPatternLabel(pattern));
  const byPath = new Map<string, Map<string, Set<number>>>();
  for (const line of result.split("\n")) {
    const firstColon = line.indexOf(":");
    if (firstColon <= 0) continue;
    const secondColon = line.indexOf(":", firstColon + 1);
    if (secondColon <= firstColon) continue;
    const path = line.slice(0, firstColon).trim();
    if (!path.startsWith("./")) continue;
    const lineNumber = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
    const text = line.slice(secondColon + 1);
    const forPath = byPath.get(path) ?? new Map<string, Set<number>>();
    for (let i = 0; i < regexes.length; i++) {
      if (!regexes[i]?.test(text)) continue;
      const label = labels[i] ?? normalized[i] ?? "";
      if (!label) continue;
      const lines = forPath.get(label) ?? new Set<number>();
      if (Number.isFinite(lineNumber) && lineNumber > 0) lines.add(lineNumber);
      forPath.set(label, lines);
    }
    if (forPath.size === 0 && labels.length > 0) {
      const label = labels[0] ?? normalized[0] ?? "";
      if (label) {
        const lines = new Set<number>();
        if (Number.isFinite(lineNumber) && lineNumber > 0) lines.add(lineNumber);
        forPath.set(label, lines);
      }
    }
    byPath.set(path, forPath);
  }
  return Array.from(byPath.entries()).map(([path, matches]) => {
    const hitTokens: string[] = [];
    for (const [label, lineNumbers] of matches.entries()) {
      const sortedLines = Array.from(lineNumbers).sort((a, b) => a - b);
      if (sortedLines.length === 0) {
        hitTokens.push(label);
        continue;
      }
      for (const ln of sortedLines) hitTokens.push(`${label}@${ln}`);
    }
    const maxHits = 4;
    if (hitTokens.length > maxHits) {
      const extra = hitTokens.length - maxHits;
      return { path, hits: [...hitTokens.slice(0, maxHits), `+${extra}`] };
    }
    return { path, hits: hitTokens };
  });
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

function escapeControlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControl = (code >= 0 && code <= 31) || code === 127;
    if (!isControl) {
      out += char;
      continue;
    }
    if (char === "\b") {
      out += "\\b";
      continue;
    }
    if (char === "\t") {
      out += "\\t";
      continue;
    }
    if (char === "\n") {
      out += "\\n";
      continue;
    }
    if (char === "\r") {
      out += "\\r";
      continue;
    }
    out += `\\x${code.toString(16).padStart(2, "0")}`;
  }
  return out;
}

function truncateValue(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
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

function unifiedDiffLines(rawResult: string): string[] {
  const start = rawResult.indexOf("diff --git ");
  if (start < 0) return [];
  return rawResult
    .slice(start)
    .split("\n")
    .map((line) => line.trimEnd());
}

export function numberedUnifiedDiffLines(rawResult: string): ToolOutputPart[] {
  const lines = unifiedDiffLines(rawResult);
  if (lines.length === 0) return [];
  const rendered: ToolOutputPart[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let fileCount = 0;
  let pendingFilePath: string | null = null;
  let fileParts: ToolOutputPart[] = [];
  let fileAdded = 0;
  let fileRemoved = 0;

  const flushFile = (): void => {
    if (!pendingFilePath || (fileAdded === 0 && fileRemoved === 0)) {
      fileParts = [];
      return;
    }
    rendered.push({ kind: "text", text: `${pendingFilePath} (+${fileAdded} -${fileRemoved})` });
    for (const part of fileParts) rendered.push(part);
    fileParts = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      fileCount += 1;
      inHunk = false;
      fileAdded = 0;
      fileRemoved = 0;
      const pathMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
      pendingFilePath = pathMatch?.[1] ?? line.slice("diff --git ".length);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number.parseInt(match[1] ?? "0", 10);
        newLine = Number.parseInt(match[2] ?? "0", 10);
        inHunk = true;
      }
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) {
      fileParts.push({ kind: "diff", lineNumber: newLine, marker: "add", text: line.slice(1) });
      fileAdded += 1;
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      fileParts.push({ kind: "diff", lineNumber: oldLine, marker: "remove", text: line.slice(1) });
      fileRemoved += 1;
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      fileParts.push({ kind: "diff", lineNumber: newLine, marker: "context", text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }
  flushFile();
  // Strip per-file headers for single-file diffs — the caller's edit-header covers it.
  return fileCount <= 1 ? rendered.filter((part) => part.kind !== "text") : rendered;
}
