import type { TokenUsage } from "./api";

export type Role = "system" | "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
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

export interface SessionStore {
  sessions: Session[];
  activeSessionId?: string;
}
