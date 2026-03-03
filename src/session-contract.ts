import { z } from "zod";
import type { TokenUsage } from "./api";
import { type Message, messageSchema } from "./chat-message";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";

const tokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  promptBudgetTokens: z.number().optional(),
  promptTruncated: z.boolean().optional(),
});

export const sessionTokenUsageEntrySchema = z.object({
  id: z.string().min(1),
  usage: tokenUsageSchema,
  warning: z.string().optional(),
  modelCalls: z.number().optional(),
});

export const sessionSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  model: z.string().min(1),
  title: z.string(),
  messages: z.array(messageSchema),
  tokenUsage: z.array(sessionTokenUsageEntrySchema),
});

export interface Session {
  id: string;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  model: string;
  title: string;
  messages: Message[];
  tokenUsage: SessionTokenUsageEntry[];
}

export interface SessionTokenUsageEntry {
  id: string;
  usage: TokenUsage;
  warning?: string;
  modelCalls?: number;
}

export const sessionStateSchema = z.object({
  sessions: z.array(sessionSchema),
  activeSessionId: z.string().optional(),
});

export interface SessionState {
  sessions: Session[];
  activeSessionId?: string;
}
