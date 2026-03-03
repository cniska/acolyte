import type { TokenUsage } from "./api";
import type { Message } from "./chat-message";

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
