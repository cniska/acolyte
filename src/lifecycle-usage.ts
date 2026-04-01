import { estimateTokens } from "./agent-input";
import type { PromptUsage } from "./lifecycle-contract";

export type PromptBreakdownTotals = {
  systemTokens: number;
  toolTokens: number;
  messageTokens: number;
};

export function createEmptyPromptBreakdownTotals(): PromptBreakdownTotals {
  return {
    systemTokens: 0,
    toolTokens: 0,
    messageTokens: 0,
  };
}

export function estimatePromptBreakdown(prompt: string, usage: PromptUsage): PromptBreakdownTotals {
  return {
    systemTokens: usage.systemPromptTokens,
    toolTokens: usage.toolTokens,
    messageTokens: estimateTokens(prompt),
  };
}

export function totalPromptBreakdownTokens(totals: PromptBreakdownTotals): number {
  return totals.systemTokens + totals.toolTokens + totals.messageTokens;
}

export function addPromptBreakdownTotals(
  current: PromptBreakdownTotals,
  next: PromptBreakdownTotals,
): PromptBreakdownTotals {
  current.systemTokens += next.systemTokens;
  current.toolTokens += next.toolTokens;
  current.messageTokens += next.messageTokens;
  return current;
}
