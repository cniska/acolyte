import type { Session, SessionState } from "./session-contract";

export interface SessionStore {
  readStore(): Promise<SessionState>;
  writeStore(record: SessionState): Promise<void>;
  createSession(model: string): Session;
}
