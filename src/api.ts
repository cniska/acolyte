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
}

export interface ChatResponse {
  output: string;
  model: string;
  usage?: TokenUsage;
  budgetWarning?: string;
  toolCalls?: string[];
  progressMessages?: string[];
  modelCalls?: number;
}
