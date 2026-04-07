import type { Session, SessionId } from "./session-contract";

export interface SessionStore {
  listSessions(options?: { limit?: number }): Promise<readonly Session[]>;
  getSession(id: SessionId): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  removeSession(id: SessionId): Promise<void>;
  getActiveSessionId(): Promise<SessionId | undefined>;
  setActiveSessionId(id: SessionId | undefined): Promise<void>;
  close(): void;
}
