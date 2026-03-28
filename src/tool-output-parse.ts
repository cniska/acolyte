import type { ToolOutputPart } from "./tool-output-content";

export type UnifiedDiffSummary = {
  files: number;
  added: number;
  removed: number;
};

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

export function compactPatternLabels(patterns: string[]): string[] {
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
  return fileCount <= 1 ? rendered.filter((part) => part.kind !== "text") : rendered;
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
