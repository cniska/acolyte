import type { PromptUsage } from "./lifecycle-contract";

export type PromptBreakdownTotals = {
  systemTokens: number;
  toolTokens: number;
  skillTokens: number;
  memoryTokens: number;
  messageTokens: number;
};

export function createEmptyPromptBreakdownTotals(): PromptBreakdownTotals {
  return {
    systemTokens: 0,
    toolTokens: 0,
    skillTokens: 0,
    memoryTokens: 0,
    messageTokens: 0,
  };
}

export function estimatePromptBreakdown(usage: PromptUsage): PromptBreakdownTotals {
  return {
    systemTokens: usage.systemPromptTokens,
    toolTokens: usage.toolTokens,
    skillTokens: usage.skillTokens,
    memoryTokens: usage.memoryTokens,
    messageTokens: usage.messageTokens,
  };
}

export function addPromptBreakdownTotals(
  current: PromptBreakdownTotals,
  next: PromptBreakdownTotals,
): PromptBreakdownTotals {
  current.systemTokens += next.systemTokens;
  current.toolTokens += next.toolTokens;
  current.skillTokens += next.skillTokens;
  current.memoryTokens += next.memoryTokens;
  current.messageTokens += next.messageTokens;
  return current;
}
