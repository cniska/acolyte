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
