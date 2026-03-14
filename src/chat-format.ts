import { t } from "./i18n";

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

export function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const rounded = Math.round(k * 10) / 10;
  if (rounded < 100) return `${rounded.toFixed(1)}k`;
  return `${Math.round(k)}k`;
}

export function formatTokenCount(tokens: number): string {
  return t("unit.token", { count: formatCompactNumber(tokens) });
}

export function formatRelativeTime(iso: string, now?: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.floor(((now ?? Date.now()) - date.getTime()) / 1000);
  if (seconds < 60) return t("chat.relative_time.just_now");
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
