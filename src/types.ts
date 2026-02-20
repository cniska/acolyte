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
}

export interface SessionStore {
  sessions: Session[];
  activeSessionId?: string;
}
