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
  progressEvents?: Array<{
    message: string;
    kind?: "status" | "tool" | "error";
    toolCallId?: string;
    toolName?: string;
    phase?: "start" | "result" | "error" | "chunk_start" | "chunk_delta" | "chunk_end";
  }>;
  modelCalls?: number;
}
