import type { Message } from "./types";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptBudgetTokens?: number;
  promptTruncated?: boolean;
}

export interface ChatRequest {
  message: string;
  history: Message[];
  model: string;
  sessionId?: string;
  resourceId?: string;
  /** When true, Mastra memory (thread history + observational memory) is enabled. */
  useMemory?: boolean;
  /** Client working directory. Falls back to server CWD when omitted. */
  workspace?: string;
}

export interface ChatResponse {
  output: string;
  model: string;
  usage?: TokenUsage;
  budgetWarning?: string;
  toolCalls?: string[];
  modelCalls?: number;
}
