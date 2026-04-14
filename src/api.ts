import { z } from "zod";
import type { ChatMessage } from "./chat-contract";
import type { ResourceId } from "./resource-id";
import type { PromptBreakdown, SessionId } from "./session-contract";
import type { ActiveSkill } from "./skill-contract";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly inputBudgetTokens?: number;
}

export interface ChatRequest {
  readonly message: string;
  readonly history: ChatMessage[];
  readonly model: string;
  readonly sessionId?: SessionId;
  readonly resourceId?: ResourceId;
  readonly activeSkills?: ActiveSkill[];
  readonly suggestions?: string[];
  /** When true, stored memories and distill observations are included in context. */
  readonly useMemory?: boolean;
  /** Client working directory. Falls back to server CWD when omitted. */
  readonly workspace?: string;
}

export const chatResponseStateSchema = z.enum(["done", "awaiting-input"]);
export type ChatResponseState = z.infer<typeof chatResponseStateSchema>;

export interface ChatResponse {
  state: ChatResponseState;
  output: string;
  model: string;
  usage?: TokenUsage;
  promptBreakdown?: PromptBreakdown;

  toolCalls?: string[];
  modelCalls?: number;
  error?: string;
}

export type WorkspaceSpecifier = Pick<ChatRequest, "workspace">;

export function createWorkspaceSpecifier(cwd: string = process.cwd()): WorkspaceSpecifier {
  return { workspace: cwd };
}
