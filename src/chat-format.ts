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
  if (minutes < 60) return t("chat.relative_time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("chat.relative_time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("chat.relative_time.days_ago", { count: days });
}

export function commandOutputColWidth(sections: [string, string][][]): number {
  const allRows = sections.flat();
  if (allRows.length === 0) return COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH;
  return Math.max(COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, ...allRows.map(([key]) => `${key}:`.length + 1));
}

export function formatCommandOutput(output: { sections: [string, string][][]; list?: string[] }): string {
  const parts: string[] = [];
  const colWidth = commandOutputColWidth(output.sections);
  if (output.sections.some((s) => s.length > 0)) {
    parts.push(
      output.sections
        .map((section) => section.map(([key, value]) => `${`${key}:`.padEnd(colWidth)}${value}`).join("\n"))
        .join("\n\n"),
    );
  }
  if (output.list && output.list.length > 0) parts.push(output.list.join("\n"));
  return parts.join("\n\n");
}

export function alignCols(rows: string[][], gap = 2): string[] {
  if (rows.length === 0) return [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < colCount - 1; c++) {
    widths.push(rows.reduce((max, row) => Math.max(max, (row[c] ?? "").length), 0));
  }
  return rows.map((row) => row.map((cell, i) => (i < widths.length ? cell.padEnd(widths[i] + gap) : cell)).join(""));
}
