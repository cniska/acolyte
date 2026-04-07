import { type ChatRow, createRow } from "./chat-contract";
import { alignCols, formatCompactNumber } from "./chat-format";
import { t } from "./i18n";
import type { SessionTokenUsageEntry } from "./session-contract";

function formatUsageValue(value: number): string {
  return formatCompactNumber(value);
}

function formatShare(tokens: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((tokens / total) * 100)}%`;
}

export function usageRows(last: SessionTokenUsageEntry | null, all: SessionTokenUsageEntry[] = []): ChatRow[] {
  if (!last) return [createRow("system", t("chat.usage.none"))];
  const totals = all.reduce(
    (acc, entry) => {
      acc.input += entry.usage.inputTokens;
      acc.output += entry.usage.outputTokens;
      acc.total += entry.usage.totalTokens;
      return acc;
    },
    { input: 0, output: 0, total: 0 },
  );
  const hasSession = all.length > 1;
  const summaryGrid: string[][] = [
    hasSession
      ? [formatUsageValue(last.usage.inputTokens), formatUsageValue(totals.input)]
      : [formatUsageValue(last.usage.inputTokens)],
    hasSession
      ? [formatUsageValue(last.usage.outputTokens), formatUsageValue(totals.output)]
      : [formatUsageValue(last.usage.outputTokens)],
    hasSession
      ? [formatUsageValue(last.usage.totalTokens), formatUsageValue(totals.total)]
      : [formatUsageValue(last.usage.totalTokens)],
  ];
  const summaryLabels = [t("chat.usage.metric.input"), t("chat.usage.metric.output"), t("chat.usage.metric.total")];
  const summaryAligned = alignCols(summaryGrid);
  const summary: [string, string][] = summaryLabels.map((label, i) => [label, summaryAligned[i]]);
  const breakdown: [string, string][] = [];
  if (last.promptBreakdown) {
    const bd = last.promptBreakdown;
    const total = Math.max(bd.usedTokens, last.usage.inputTokens);
    const breakdownGrid: string[][] = [];
    const breakdownLabels: string[] = [];
    for (const [label, tokens] of [
      [t("chat.usage.metric.system"), bd.systemTokens],
      [t("chat.usage.metric.tools"), bd.toolTokens],
      [t("chat.usage.metric.memory"), bd.memoryTokens],
      [t("chat.usage.metric.messages"), bd.messageTokens],
    ] as [string, number][]) {
      breakdownLabels.push(label);
      breakdownGrid.push([formatUsageValue(tokens), formatShare(tokens, total)]);
    }
    const breakdownAligned = alignCols(breakdownGrid);
    for (let i = 0; i < breakdownLabels.length; i++) {
      breakdown.push([breakdownLabels[i], breakdownAligned[i]]);
    }
  }
  const sections: [string, string][][] = [summary];
  if (breakdown.length > 0) sections.push(breakdown);
  return [createRow("system", { header: t("chat.usage.header"), sections })];
}
