import type { LanguageModelV3FunctionTool, LanguageModelV3Message } from "@ai-sdk/provider";
import { estimateTokens } from "./agent-input";

export type PromptSize = {
  total: number;
  system: number;
  tools: number;
  messages: number;
};

export function estimatePromptSize(
  messages: LanguageModelV3Message[],
  tools: LanguageModelV3FunctionTool[],
): PromptSize {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");
  const system = systemMessages.length === 0 ? 0 : estimateTokens(JSON.stringify(systemMessages));
  const toolsTokens = tools.length === 0 ? 0 : estimateTokens(JSON.stringify(tools));
  const messagesTokens = otherMessages.length === 0 ? 0 : estimateTokens(JSON.stringify(otherMessages));
  return {
    total: system + toolsTokens + messagesTokens,
    system,
    tools: toolsTokens,
    messages: messagesTokens,
  };
}

export function promptBudgetError(size: PromptSize, limit: number): string | undefined {
  if (size.total <= limit) return undefined;
  return `Prompt exceeds per-call input budget (${size.total} tokens, limit ${limit}; system=${size.system} tools=${size.tools} messages=${size.messages}).`;
}
