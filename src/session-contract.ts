import { z } from "zod";
import type { TokenUsage } from "./api";
import { type ChatMessage, type MessageId, messageIdSchema, messageSchema } from "./chat-contract";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

export const sessionIdSchema = domainIdSchema("sess");
export type SessionId = z.infer<typeof sessionIdSchema>;

const tokenUsageSchema = z.object({
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

export const sessionSchema = z.object({
  id: sessionIdSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  model: z.string().min(1),
  title: z.string(),
  workspace: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
  workspaceBranch: z.string().min(1).optional(),
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
