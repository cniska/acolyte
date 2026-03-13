import { z } from "zod";
import type { TokenUsage } from "./api";
import { type ChatMessage, type MessageId, messageIdSchema, messageSchema } from "./chat-contract";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

export const sessionIdSchema = domainIdSchema("sess");
export type SessionId = z.infer<typeof sessionIdSchema>;

const tokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  promptBudgetTokens: z.number().optional(),
  promptTruncated: z.boolean().optional(),
});

export const sessionTokenUsageEntrySchema = z.object({
  id: messageIdSchema,
  usage: tokenUsageSchema,
  warning: z.string().optional(),
  modelCalls: z.number().optional(),
});

export const sessionSchema = z.object({
  id: sessionIdSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  model: z.string().min(1),
  title: z.string(),
  messages: z.array(messageSchema),
  tokenUsage: z.array(sessionTokenUsageEntrySchema),
});

export interface Session {
  readonly id: SessionId;
  readonly createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  model: string;
  title: string;
  messages: ChatMessage[];
  tokenUsage: SessionTokenUsageEntry[];
}

export interface SessionTokenUsageEntry {
  readonly id: MessageId;
  readonly usage: TokenUsage;
  readonly warning?: string;
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
