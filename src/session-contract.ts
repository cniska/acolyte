import { z } from "zod";
import type { TokenUsage } from "./api";
import { type ChatMessage, type MessageId, messageIdSchema, messageSchema } from "./chat-contract";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

export const sessionIdSchema = domainIdSchema("sess");
export type SessionId = z.infer<typeof sessionIdSchema>;

export const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  inputBudgetTokens: z.number().optional(),
  inputTruncated: z.boolean().optional(),
});

export const promptBreakdownSchema = z.object({
  budgetTokens: z.number(),
  usedTokens: z.number(),
  systemTokens: z.number(),
  toolTokens: z.number(),
  memoryTokens: z.number(),
  messageTokens: z.number(),
});

export type PromptBreakdown = z.infer<typeof promptBreakdownSchema>;

export const sessionTokenUsageEntrySchema = z.object({
  id: messageIdSchema,
  usage: tokenUsageSchema,
  promptBreakdown: promptBreakdownSchema.optional(),

  modelCalls: z.number().optional(),
});

export const activeSkillSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
});

export type ActiveSkill = z.infer<typeof activeSkillSchema>;

export const sessionSchema = z.object({
  id: sessionIdSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  model: z.string().min(1),
  title: z.string(),
  workspace: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
  workspaceBranch: z.string().min(1).optional(),
  activeSkill: activeSkillSchema.optional(),
  messages: z.array(messageSchema),
  tokenUsage: z.array(sessionTokenUsageEntrySchema),
});

export interface Session {
  readonly id: SessionId;
  readonly createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  model: string;
  title: string;
  workspace?: string;
  workspaceName?: string;
  workspaceBranch?: string;
  activeSkill?: ActiveSkill;
  messages: ChatMessage[];
  tokenUsage: SessionTokenUsageEntry[];
}

export interface SessionTokenUsageEntry {
  readonly id: MessageId;
  readonly usage: TokenUsage;
  readonly promptBreakdown?: z.infer<typeof promptBreakdownSchema>;

  readonly modelCalls?: number;
}

export const sessionStateSchema = z.object({
  sessions: z.array(sessionSchema),
  activeSessionId: sessionIdSchema.optional(),
});

export interface SessionState {
  sessions: Session[];
  activeSessionId?: SessionId;
}

export interface SessionStore {
  listSessions(options?: { limit?: number }): Promise<readonly Session[]>;
  getSession(id: SessionId): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  removeSession(id: SessionId): Promise<void>;
  getActiveSessionId(): Promise<SessionId | undefined>;
  setActiveSessionId(id: SessionId | undefined): Promise<void>;
  close(): void;
}
