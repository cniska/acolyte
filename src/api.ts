import { z } from "zod";
import type { AgentMode } from "./agent-contract";
import type { ChatMessage } from "./chat-contract";
import type { ResourceId } from "./resource-id";
import type { SessionId } from "./session-contract";

export const verifyScopeSchema = z.enum(["task", "global"]);
export type VerifyScope = z.infer<typeof verifyScopeSchema>;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly inputBudgetTokens?: number;
  readonly inputTruncated?: boolean;
}

export interface PromptBreakdown {
  readonly budgetTokens: number;
  readonly usedTokens: number;
  readonly systemTokens: number;
  readonly toolTokens: number;
  readonly memoryTokens: number;
  readonly messageTokens: number;
}

export interface ChatRequest {
  readonly message: string;
  readonly history: ChatMessage[];
  readonly model: string;
  readonly modeModels?: Partial<Record<AgentMode, string>>;
  readonly sessionId?: SessionId;
  readonly resourceId?: ResourceId;
  /** When true, stored memories and distill observations are included in context. */
  readonly useMemory?: boolean;
  /** Verifier read scope: task-bound by default; global only when explicitly requested. */
  readonly verifyScope?: VerifyScope;
  /** Client working directory. Falls back to server CWD when omitted. */
  readonly workspace?: string;
}

export interface ChatResponse {
  output: string;
  model: string;
  usage?: TokenUsage;
  promptBreakdown?: PromptBreakdown;
  budgetWarning?: string;
  toolCalls?: string[];
  modelCalls?: number;
  error?: string;
}

export type WorkspaceSpecifier = Pick<ChatRequest, "workspace">;

export function createWorkspaceSpecifier(cwd: string = process.cwd()): WorkspaceSpecifier {
  return { workspace: cwd };
}
