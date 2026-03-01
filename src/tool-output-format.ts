import { countLabel } from "./plural";
import { formatToolLabel } from "./tool-labels";
import type { ToolName } from "./tool-names";

type ToolOutputListener = (event: { toolName: ToolName; message: string; toolCallId?: string }) => void;

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
      message: `… ${countLabel(allLines.length - maxLines, "line", "lines")} truncated`,
      toolCallId,
    });
}

export function emitFileListSummary(
  toolName: ToolName,
  filePaths: string[],
  onToolOutput?: ToolOutputListener,
  toolCallId?: string,
  maxFiles = 5,
): void {
  if (!onToolOutput) return;
  const unique = Array.from(new Set(filePaths.map((path) => path.trim()).filter((path) => path.length > 0)));
  if (unique.length === 0) return;
  onToolOutput({
    toolName,
    message: `${formatToolLabel(toolName)} ${countLabel(unique.length, "file", "files")}`,
    toolCallId,
  });
  for (const path of unique.slice(0, maxFiles)) onToolOutput({ toolName, message: `  ${path}`, toolCallId });
  if (unique.length > maxFiles)
    onToolOutput({ toolName, message: `  … +${countLabel(unique.length - maxFiles, "file", "files")}`, toolCallId });
}

export function findResultPaths(result: string): string[] {
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("./"));
}

export function searchResultPaths(result: string): string[] {
  const files = new Set<string>();
  for (const line of result.split("\n")) {
    const firstColon = line.indexOf(":");
    if (firstColon <= 0) continue;
    const path = line.slice(0, firstColon).trim();
    if (path.startsWith("./")) files.add(path);
  }
  return Array.from(files);
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
      if (skippedCount > 0) filtered.push("…");
      skippedCount = 0;
      filtered.push(rendered[i] ?? "");
    } else {
      skippedCount += 1;
    }
  }
  if (filtered.length > maxLines) {
    const omitted = filtered.length - maxLines;
    return [...filtered.slice(0, maxLines), `… +${omitted} lines`];
  }
  return filtered;
}
