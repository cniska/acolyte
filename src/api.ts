import { z } from "zod";
import type { Message } from "./chat-message";

export const verifyScopeSchema = z.enum(["task", "global"]);
export type VerifyScope = z.infer<typeof verifyScopeSchema>;

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
  /** Verifier read scope: task-bound by default; global only when explicitly requested. */
  verifyScope?: VerifyScope;
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

export type WorkspaceSpecifier = Pick<ChatRequest, "workspace">;

export function createWorkspaceSpecifier(cwd: string = process.cwd()): WorkspaceSpecifier {
  return { workspace: cwd };
}
