import { countLabel } from "./plural";

export const COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH = 20;

export function formatThoughtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (seconds === 60) return `${minutes + 1}m 0s`;
  return `${minutes}m ${seconds}s`;
}

export function formatRelativeTime(iso: string, now?: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.floor(((now ?? Date.now()) - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatColumns(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const colCount = rows[0].length;
  const widths: number[] = [];
  for (let c = 0; c < colCount - 1; c++) {
    widths.push(rows.reduce((max, row) => Math.max(max, (row[c] ?? "").length), 0));
  }
  return rows.map((row) => row.map((cell, i) => (i < widths.length ? cell.padEnd(widths[i] + 2) : cell)).join(""));
}

export function formatChangesSummary(statusRaw: string, diffRaw: string): string {
  const statusLines = statusRaw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const branchLine = statusLines.find((line) => line.startsWith("## "));
  const changedFilesFromStatus = statusLines.filter((line) => !line.startsWith("## ")).length;

  let added = 0;
  let removed = 0;
  let changedFilesFromDiff = 0;
  for (const line of diffRaw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      changedFilesFromDiff += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  const changedFiles = Math.max(changedFilesFromStatus, changedFilesFromDiff);

  const summary: string[] = [];
  summary.push(
    changedFiles === 0 ? "Working tree clean." : `${countLabel(changedFiles, "changed file", "changed files")}.`,
  );
  if (branchLine) summary.push(branchLine);
  if (changedFiles > 0) summary.push(`Diff summary: +${added} -${removed}.`);
  return summary.join("\n");
}
