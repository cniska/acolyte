import type { Backend } from "./backend";
import type { Message, Session, SessionStore } from "./types";

const DEFAULT_TIME = "2026-02-20T00:00:00.000Z";

export function createMessage(
  role: Message["role"] = "user",
  content = "test",
  overrides: Partial<Message> = {},
): Message {
  return {
    id: overrides.id ?? "msg_test",
    role,
    content,
    timestamp: overrides.timestamp ?? DEFAULT_TIME,
  };
}

export function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? "sess_test001",
    createdAt: overrides.createdAt ?? DEFAULT_TIME,
    updatedAt: overrides.updatedAt ?? DEFAULT_TIME,
    model: overrides.model ?? "gpt-5-mini",
    title: overrides.title ?? "New Session",
    messages: overrides.messages ?? [],
  };
}

export function createStore(overrides: Partial<SessionStore> = {}): SessionStore {
  const sessions = overrides.sessions ?? [
    createSession({ id: "sess_test001" }),
    createSession({ id: "sess_test002", title: "Second Session" }),
  ];
  return {
    activeSessionId: overrides.activeSessionId ?? sessions[0]?.id ?? "sess_test001",
    sessions,
  };
}

export function createBackend(overrides?: { reply?: Backend["reply"]; status?: Backend["status"] }): Backend {
  return {
    reply:
      overrides?.reply ??
      (async () => ({
        model: "gpt-5-mini",
        output: "ok",
      })),
    status: overrides?.status ?? (async () => "provider=local model=gpt-5-mini"),
  };
}
