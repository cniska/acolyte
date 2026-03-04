import { z } from "zod";
import type { AgentMode } from "./agent-modes";
import type { Message } from "./chat-message";
import type { SessionId } from "./session-contract";

export const verifyScopeSchema = z.enum(["task", "global"]);
export type VerifyScope = z.infer<typeof verifyScopeSchema>;

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly promptBudgetTokens?: number;
  readonly promptTruncated?: boolean;
}

export interface ChatRequest {
  readonly message: string;
  readonly history: Message[];
  readonly model: string;
  readonly modeModels?: Partial<Record<AgentMode, string>>;
  readonly sessionId?: SessionId;
  readonly resourceId?: string;
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
  budgetWarning?: string;
  toolCalls?: string[];
  modelCalls?: number;
}

export type WorkspaceSpecifier = Pick<ChatRequest, "workspace">;

export function createWorkspaceSpecifier(cwd: string = process.cwd()): WorkspaceSpecifier {
  return { workspace: cwd };
}
