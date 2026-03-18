import { isAbsolute, relative } from "node:path";
import type { ToolOutputPart } from "./tool-output-content";

export type ToolOutputListener = (event: { toolName: string; content: ToolOutputPart; toolCallId?: string }) => void;

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

const NUMBERED_DIFF_PREVIEW_MAX_LINES = 160;
const NUMBERED_DIFF_SOURCE_MAX_LINES = NUMBERED_DIFF_PREVIEW_MAX_LINES * 2;

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

export function createDiffSummaryEmitter<TToolName extends string>(input: {
  toolName: TToolName;
  label: string;
  onOutput: ToolOutputListener;
}): (path: string, rawResult: string, toolCallId: string) => void {
  const { toolName, label, onOutput } = input;
  return (path, rawResult, toolCallId) => {
    const { files, added, removed } = summarizeUnifiedDiff(rawResult);
    const touchedFiles = files > 0 ? files : 1;
    onOutput({
      toolName,
      content: { kind: "edit-header", label, path, files: touchedFiles, added, removed },
      toolCallId,
    });
  };
}

export function emitHeadTailLines(
  toolName: string,
  rawText: string,
  onOutput: ToolOutputListener,
  toolCallId: string,
  options?: { headRows?: number; tailRows?: number },
): void {
  const headRows = options?.headRows ?? 2;
  const tailRows = options?.tailRows ?? 2;
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    onOutput({ toolName, content: { kind: "no-output" }, toolCallId });
    return;
  }
  if (lines.length > headRows + tailRows) {
    const omitted = lines.length - (headRows + tailRows);
    for (const line of lines.slice(0, headRows))
      onOutput({ toolName, content: { kind: "text", text: line }, toolCallId });
    onOutput({ toolName, content: { kind: "truncated", count: omitted, unit: "lines" }, toolCallId });
    for (const line of lines.slice(lines.length - tailRows))
      onOutput({ toolName, content: { kind: "text", text: line }, toolCallId });
    return;
  }
  for (const line of lines) onOutput({ toolName, content: { kind: "text", text: line }, toolCallId });
}

export function emitResultChunks(
  toolName: string,
  result: string,
  onOutput: ToolOutputListener,
  maxLines = 80,
  toolCallId?: string,
): void {
  const allLines = result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines = allLines.slice(0, maxLines);
  for (const line of lines) {
    onOutput({ toolName, content: { kind: "text", text: line }, toolCallId });
  }
  if (allLines.length > maxLines)
    onOutput({
      toolName,
      content: { kind: "truncated", count: allLines.length - maxLines, unit: "lines" },
      toolCallId,
    });
}

export function emitFileListSummary(
  toolName: string,
  filePaths: string[],
  onOutput: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_LIMITS.files,
  workspace?: string,
): void {
  emitSummaryFileRows({
    toolName,
    filePaths,
    onOutput,
    toolCallId,
    maxFiles,
    header: (count) => `files=${count}`,
    lineForPath: (path) => toDisplayPath(path, workspace),
  });
}

export function emitFindSummary(
  filePaths: string[],
  patterns: string[],
  label: string,
  onOutput: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_LIMITS.files,
  workspace?: string,
): void {
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return;
  const labels = compactPatternLabels(patterns);
  onOutput({
    toolName: "find-files",
    content: { kind: "scope-header", label, scope: "workspace", patterns: labels, matches: unique.length },
    toolCallId,
  });
  const displayed = unique.slice(0, maxFiles).map((path) => toDisplayPath(path, workspace));
  const allInHeader = displayed.every((d) => labels.some((l) => d.endsWith(l) || l.endsWith(d)));
  if (!allInHeader) {
    for (const path of displayed) {
      onOutput({ toolName: "find-files", content: { kind: "text", text: path }, toolCallId });
    }
    if (unique.length > maxFiles)
      onOutput({
        toolName: "find-files",
        content: { kind: "truncated", count: unique.length - maxFiles, unit: "matches" },
        toolCallId,
      });
  }
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

function emitSummaryFileRows(input: {
  toolName: string;
  filePaths: string[];
  onOutput: ToolOutputListener;
  toolCallId?: string;
  maxFiles: number;
  header: (count: number) => string;
  lineForPath: (path: string) => string;
}): void {
  const { toolName, filePaths, onOutput, toolCallId, maxFiles, header, lineForPath } = input;

  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return;
  onOutput({
    toolName,
    content: { kind: "text", text: header(unique.length) },
    toolCallId,
  });
  for (const path of unique.slice(0, maxFiles)) {
    onOutput({
      toolName,
      content: { kind: "text", text: lineForPath(path) },
      toolCallId,
    });
  }
  if (unique.length > maxFiles)
    onOutput({
      toolName,
      content: { kind: "truncated", count: unique.length - maxFiles, unit: "matches" },
      toolCallId,
    });
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

export function emitSearchSummary(
  entries: SearchSummaryEntry[],
  patterns: string[],
  paths: string[] | undefined,
  label: string,
  onOutput: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_LIMITS.files,
  workspace?: string,
): void {
  const filePaths = entries.map((entry) => entry.path);
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return;
  const hitsByPath = new Map(entries.map((entry) => [entry.path, entry.hits] as const));
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
  onOutput({
    toolName: "search-files",
    content: { kind: "scope-header", label, scope, patterns: labels, matches: unique.length },
    toolCallId,
  });
  for (const path of unique.slice(0, maxFiles)) {
    const display = toDisplayPath(path, workspace);
    const hits = hitsByPath.get(path) ?? [];
    const text = hits.length === 0 ? display : `${display} [${hits.join(", ")}]`;
    onOutput({ toolName: "search-files", content: { kind: "text", text }, toolCallId });
  }
  if (unique.length > maxFiles)
    onOutput({
      toolName: "search-files",
      content: { kind: "truncated", count: unique.length - maxFiles, unit: "matches" },
      toolCallId,
    });
}

function unifiedDiffLines(rawResult: string, maxLines = 120): string[] {
  const marker = "\ndiff --git ";
  const index = rawResult.indexOf(marker);
  const start = index >= 0 ? index + 1 : rawResult.indexOf("diff --git ");
  if (start < 0) return [];
  const lines = rawResult
    .slice(start)
    .split("\n")
    .map((line) => line.trimEnd());
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}

export function numberedUnifiedDiffLines(rawResult: string): ToolOutputPart[] {
  const lines = unifiedDiffLines(rawResult, NUMBERED_DIFF_SOURCE_MAX_LINES);
  if (lines.length === 0) return [];
  const rendered: ToolOutputPart[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let fileCount = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      fileCount += 1;
      inHunk = false;
      if (fileCount > 1) {
        const pathMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
        const path = pathMatch?.[1] ?? line.slice("diff --git ".length);
        rendered.push({ kind: "text", text: path });
      }
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
      rendered.push({ kind: "diff", lineNumber: newLine, marker: "add", text: line.slice(1) });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rendered.push({ kind: "diff", lineNumber: oldLine, marker: "remove", text: line.slice(1) });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      rendered.push({ kind: "diff", lineNumber: newLine, marker: "context", text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }
  if (rendered.length === 0) {
    oldLine = 1;
    newLine = 1;
    for (const line of lines) {
      if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@"))
        continue;
      if (line.startsWith("+")) {
        rendered.push({ kind: "diff", lineNumber: newLine, marker: "add", text: line.slice(1) });
        newLine += 1;
        continue;
      }
      if (line.startsWith("-")) {
        rendered.push({ kind: "diff", lineNumber: oldLine, marker: "remove", text: line.slice(1) });
        oldLine += 1;
        continue;
      }
      if (line.startsWith(" ")) {
        rendered.push({ kind: "diff", lineNumber: newLine, marker: "context", text: line.slice(1) });
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  if (rendered.length === 0) return [];
  const contextRadius = 3;
  const isChange = rendered.map((line) => line.kind === "diff" && line.marker !== "context");
  const keep = new Uint8Array(rendered.length);
  for (let i = 0; i < rendered.length; i++) {
    if (!isChange[i]) continue;
    for (let j = Math.max(0, i - contextRadius); j <= Math.min(rendered.length - 1, i + contextRadius); j++) {
      keep[j] = 1;
    }
  }
  const filteredOutput: ToolOutputPart[] = [];
  let skippedCount = 0;
  for (let i = 0; i < rendered.length; i++) {
    if (keep[i]) {
      if (skippedCount > 0) filteredOutput.push({ kind: "truncated", count: skippedCount, unit: "lines" });
      skippedCount = 0;
      filteredOutput.push(rendered[i] as ToolOutputPart);
    } else {
      skippedCount += 1;
    }
  }
  if (skippedCount > 0) filteredOutput.push({ kind: "truncated", count: skippedCount, unit: "lines" });
  if (filteredOutput.length > NUMBERED_DIFF_PREVIEW_MAX_LINES) {
    const omitted = filteredOutput.length - NUMBERED_DIFF_PREVIEW_MAX_LINES;
    return [
      ...filteredOutput.slice(0, NUMBERED_DIFF_PREVIEW_MAX_LINES),
      { kind: "truncated", count: omitted, unit: "lines" },
    ];
  }
  return filteredOutput;
}
