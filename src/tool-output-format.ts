import { isAbsolute, relative } from "node:path";
import { countLabel } from "./plural";
import type { ToolName } from "./tool-names";
import { TOOL_OUTPUT_MARKERS } from "./tool-output-parser";

export type ToolOutputListener = (event: { toolName: ToolName; message: string; toolCallId?: string }) => void;
export const TOOL_OUTPUT_RUN_MAX_ROWS = 5;
export const TOOL_OUTPUT_FILES_MAX_ROWS = 5;
export const TOOL_OUTPUT_INLINE_FILES_MAX = 3;

export function emitHeadTailLines(
  toolName: ToolName,
  rawText: string,
  onToolOutput: ToolOutputListener | undefined,
  toolCallId: string,
  options?: { headRows?: number; tailRows?: number; trimStart?: boolean },
): void {
  if (!onToolOutput) return;
  const headRows = options?.headRows ?? 2;
  const tailRows = options?.tailRows ?? 2;
  const lines = rawText
    .split("\n")
    .map((line) => {
      const base = line.trimEnd();
      return options?.trimStart ? base.trimStart() : base;
    })
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    onToolOutput({ toolName, message: TOOL_OUTPUT_MARKERS.noOutput, toolCallId });
    return;
  }
  if (lines.length > headRows + tailRows) {
    const omitted = lines.length - (headRows + tailRows);
    const preview = [
      ...lines.slice(0, headRows),
      `${TOOL_OUTPUT_MARKERS.truncated} +${countLabel(omitted, "line", "lines")}`,
      ...lines.slice(lines.length - tailRows),
    ];
    for (const line of preview) onToolOutput({ toolName, message: line, toolCallId });
    return;
  }
  for (const line of lines) onToolOutput({ toolName, message: line, toolCallId });
}

export function emitResultChunks(
  toolName: ToolName,
  result: string,
  onToolOutput?: ToolOutputListener,
  maxLines = 80,
  toolCallId?: string,
): void {
  if (!onToolOutput) return;
  const allLines = result
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const lines = allLines.slice(0, maxLines);
  for (const line of lines) {
    onToolOutput({ toolName, message: line, toolCallId });
  }
  if (allLines.length > maxLines)
    onToolOutput({
      toolName,
      message: `${TOOL_OUTPUT_MARKERS.truncated} +${countLabel(allLines.length - maxLines, "line", "lines")}`,
      toolCallId,
    });
}

export function emitFileListSummary(
  toolName: ToolName,
  filePaths: string[],
  onToolOutput?: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_FILES_MAX_ROWS,
  workspace?: string,
): void {
  if (!onToolOutput) return;
  if (toolName === "read-file" || toolName === "scan-code") {
    const unique = uniquePaths(filePaths).map((path) => toDisplayPath(path, workspace));
    if (unique.length === 0) return;
    const shown = unique.slice(0, TOOL_OUTPUT_INLINE_FILES_MAX);
    const remaining = unique.length - shown.length;
    onToolOutput({
      toolName,
      message: `paths=${unique.length} targets=[${shown.join(", ")}]${remaining > 0 ? ` omitted=${remaining}` : ""}`,
      toolCallId,
    });
    return;
  }
  emitSummaryFileRows({
    toolName,
    filePaths,
    onToolOutput,
    toolCallId,
    maxFiles,
    header: (count) => `files=${count}`,
    lineForPath: (path) => toDisplayPath(path, workspace),
  });
}

export function emitFindSummary(
  filePaths: string[],
  patterns: string[],
  onToolOutput?: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_FILES_MAX_ROWS,
  workspace?: string,
): void {
  const labels = compactPatternLabels(patterns);
  emitSummaryFileRows({
    toolName: "find-files",
    filePaths,
    onToolOutput,
    toolCallId,
    maxFiles,
    header: (count) => {
      const patternToken = labels.length > 0 ? `[${labels.join(", ")}]` : "[]";
      return `scope=workspace patterns=${patternToken} matches=${count}`;
    },
    lineForPath: (path) => toDisplayPath(path, workspace),
  });
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
    for (let i = 0; i < regexes.length; i += 1) {
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
  if (trimmed.length === 0) return trimmed;
  if (trimmed.endsWith("/") || trimmed.includes("*")) return trimmed;
  const leaf = trimmed.split("/").at(-1) ?? trimmed;
  if (leaf.includes(".")) return trimmed;
  return `${trimmed}/`;
}

function uniquePaths(filePaths: string[]): string[] {
  return Array.from(new Set(filePaths.map((path) => path.trim()).filter((path) => path.length > 0)));
}

function emitSummaryFileRows(input: {
  toolName: ToolName;
  filePaths: string[];
  onToolOutput?: ToolOutputListener;
  toolCallId?: string;
  maxFiles: number;
  header: (count: number) => string;
  lineForPath: (path: string) => string;
}): void {
  const { toolName, filePaths, onToolOutput, toolCallId, maxFiles, header, lineForPath } = input;
  if (!onToolOutput) return;
  const unique = uniquePaths(filePaths);
  if (unique.length === 0) return;
  onToolOutput({
    toolName,
    message: header(unique.length),
    toolCallId,
  });
  for (const path of unique.slice(0, maxFiles)) {
    onToolOutput({
      toolName,
      message: lineForPath(path),
      toolCallId,
    });
  }
  if (unique.length > maxFiles)
    onToolOutput({
      toolName,
      message: `${TOOL_OUTPUT_MARKERS.truncated} +${unique.length - maxFiles}`,
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
  onToolOutput?: ToolOutputListener,
  toolCallId?: string,
  maxFiles = TOOL_OUTPUT_FILES_MAX_ROWS,
  workspace?: string,
): void {
  const filePaths = entries.map((entry) => entry.path);
  const hitsByPath = new Map(entries.map((entry) => [entry.path, entry.hits] as const));
  const labels = compactPatternLabels(patterns);
  const normalizedPaths = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  const scopeLabels = Array.from(
    new Set(normalizedPaths.map((path) => normalizeScopeLabel(toDisplayPath(path, workspace)))),
  );
  emitSummaryFileRows({
    toolName: "search-files",
    filePaths,
    onToolOutput,
    toolCallId,
    maxFiles,
    header: (count) => {
      const patternToken = labels.length > 0 ? `[${labels.join(", ")}]` : "[]";
      if (normalizedPaths.length === 1) {
        const scope = scopeLabels[0] ?? toDisplayPath(normalizedPaths[0] ?? "", workspace);
        return `scope=${scope} patterns=${patternToken} matches=${count}`;
      }
      if (normalizedPaths.length > 1) {
        const shown = scopeLabels.slice(0, 3).join(", ");
        const remaining = scopeLabels.length - Math.min(scopeLabels.length, 3);
        const scope = remaining > 0 ? `${shown}, +${remaining}` : shown;
        return `scope=${scope} patterns=${patternToken} matches=${count}`;
      }
      return `scope=workspace patterns=${patternToken} matches=${count}`;
    },
    lineForPath: (path) => {
      const display = toDisplayPath(path, workspace);
      const hits = hitsByPath.get(path) ?? [];
      if (hits.length === 0) return display;
      return `${display} [${hits.join(", ")}]`;
    },
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

export function numberedUnifiedDiffLines(rawResult: string, maxLines = 160): string[] {
  const lines = unifiedDiffLines(rawResult, Math.max(maxLines * 2, 240));
  if (lines.length === 0) return [];
  const rendered: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number.parseInt(match[1] ?? "0", 10);
        newLine = Number.parseInt(match[2] ?? "0", 10);
        inHunk = true;
      }
      continue;
    }
    if (!inHunk || line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    if (line.startsWith("+")) {
      rendered.push(`${newLine} + ${line.slice(1)}`);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rendered.push(`${oldLine} - ${line.slice(1)}`);
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      rendered.push(`${newLine}  ${line.slice(1)}`);
      oldLine += 1;
      newLine += 1;
      continue;
    }
    rendered.push(line);
  }
  if (rendered.length === 0) {
    oldLine = 1;
    newLine = 1;
    for (const line of lines) {
      if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@"))
        continue;
      if (line.startsWith("+")) {
        rendered.push(`${newLine} + ${line.slice(1)}`);
        newLine += 1;
        continue;
      }
      if (line.startsWith("-")) {
        rendered.push(`${oldLine} - ${line.slice(1)}`);
        oldLine += 1;
        continue;
      }
      if (line.startsWith(" ")) {
        rendered.push(`${newLine}  ${line.slice(1)}`);
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  if (rendered.length === 0) return [];
  const contextRadius = 3;
  const isChange = rendered.map((line) => /^\d+\s+[+-]\s/.test(line));
  const keep = new Uint8Array(rendered.length);
  for (let i = 0; i < rendered.length; i++) {
    if (!isChange[i]) continue;
    for (let j = Math.max(0, i - contextRadius); j <= Math.min(rendered.length - 1, i + contextRadius); j++) {
      keep[j] = 1;
    }
  }
  const filtered: string[] = [];
  let skippedCount = 0;
  for (let i = 0; i < rendered.length; i++) {
    if (keep[i]) {
      if (skippedCount > 0) filtered.push(TOOL_OUTPUT_MARKERS.truncated);
      skippedCount = 0;
      filtered.push(rendered[i] ?? "");
    } else {
      skippedCount += 1;
    }
  }
  if (skippedCount > 0) filtered.push(TOOL_OUTPUT_MARKERS.truncated);
  if (filtered.length > maxLines) {
    const omitted = filtered.length - maxLines;
    return [...filtered.slice(0, maxLines), `${TOOL_OUTPUT_MARKERS.truncated} +${omitted} lines`];
  }
  return filtered;
}
