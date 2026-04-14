import type { PromptUsage } from "./lifecycle-contract";

export type PromptBreakdownTotals = {
  systemTokens: number;
  toolTokens: number;
  memoryTokens: number;
  messageTokens: number;
};

export function createEmptyPromptBreakdownTotals(): PromptBreakdownTotals {
  return {
    systemTokens: 0,
    toolTokens: 0,
    memoryTokens: 0,
    messageTokens: 0,
  };
}

export function estimatePromptBreakdown(usage: PromptUsage): PromptBreakdownTotals {
  return {
    systemTokens: usage.systemPromptTokens,
    toolTokens: usage.toolTokens,
    memoryTokens: usage.memoryTokens,
    messageTokens: usage.messageTokens,
  };
}

export function totalPromptBreakdownTokens(totals: PromptBreakdownTotals): number {
  return totals.systemTokens + totals.toolTokens + totals.memoryTokens + totals.messageTokens;
}

export function addPromptBreakdownTotals(
  current: PromptBreakdownTotals,
  next: PromptBreakdownTotals,
): PromptBreakdownTotals {
  current.systemTokens += next.systemTokens;
  current.toolTokens += next.toolTokens;
  current.memoryTokens += next.memoryTokens;
  current.messageTokens += next.messageTokens;
  return current;
}
