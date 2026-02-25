import type { Backend } from "./backend";
import type { ChatRow } from "./chat-commands";
import { createSubmitHandler } from "./chat-submit-handler";
import type { PolicyCandidate } from "./policy-distill";
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
    tokenUsage: overrides.tokenUsage ?? [],
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

type TestProgressPayload = {
  sessionId: string;
  requestId: string;
  done: boolean;
  events: Array<{
    seq: number;
    message: string;
    kind?: "status" | "tool" | "error";
    toolCallId?: string;
    toolName?: string;
    phase?: "tool_start" | "tool_chunk" | "tool_end";
  }>;
} | null;

export function createBackend(overrides?: {
  reply?: Backend["reply"];
  replyStream?: Backend["replyStream"];
  status?: Backend["status"];
  progress?: (sessionId: string, afterSeq: number) => Promise<TestProgressPayload>;
  setPermissionMode?: Backend["setPermissionMode"];
}): Backend {
  const reply =
    overrides?.reply ??
    (async () => ({
      model: "gpt-5-mini",
      output: "ok",
    }));
  const replyStream =
    overrides?.replyStream ??
    (async (input, options) => {
      const progress = overrides?.progress;
      if (!progress) {
        return reply(input, { signal: options.signal });
      }
      const replyPromise = reply(input, { signal: options.signal });
      let cursor = 0;
      for (let i = 0; i < 40; i += 1) {
        if (options.signal?.aborted) {
          break;
        }
        const payload = await progress(input.sessionId ?? "sess_test", cursor);
        if (!payload) {
          break;
        }
        if (payload.events.length > 0) {
          const latestEvent = payload.events[payload.events.length - 1];
          if (latestEvent) {
            cursor = latestEvent.seq;
          }
          options.onEvents(payload.events);
        }
        if (payload.done) {
          break;
        }
        await Bun.sleep(50);
      }
      return replyPromise;
    });
  return {
    reply,
    replyStream,
    status: overrides?.status ?? (async () => "provider=local model=gpt-5-mini memory_context=2"),
    setPermissionMode: overrides?.setPermissionMode ?? (async () => {}),
  };
}

export type SubmitHandlerHarness = {
  submit: (raw: string) => Promise<void>;
  rows: ChatRow[];
  session: Session;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowShortcuts: Array<boolean | ((current: boolean) => boolean)>;
  };
};

export function createSubmitHandlerHarness(overrides?: {
  isThinking?: boolean;
  backend?: Backend;
  pendingPolicyCandidate?: PolicyCandidate | null;
}): SubmitHandlerHarness {
  const rows: ChatRow[] = [];
  const calls = {
    setInputHistory: 0,
    setValue: [] as string[],
    setShowShortcuts: [] as Array<boolean | ((current: boolean) => boolean)>,
  };
  const session = createSession({ id: "sess_test" });
  const store = createStore({ activeSessionId: session.id, sessions: [session] });
  const submit = createSubmitHandler({
    backend: overrides?.backend ?? createBackend({ status: async () => "ok" }),
    store,
    currentSession: session,
    setCurrentSession: () => {},
    toRows: () => [],
    setRows: (updater) => {
      rows.splice(0, rows.length, ...updater(rows));
    },
    setShowShortcuts: (next) => {
      calls.setShowShortcuts.push(next);
    },
    setValue: (next) => {
      calls.setValue.push(next);
    },
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openPermissionsPanel: () => {},
    openPolicyPanel: () => {},
    openClarifyPanel: () => {},
    openWriteConfirmPanel: () => {},
    pendingPolicyCandidate: overrides?.pendingPolicyCandidate ?? null,
    setPendingPolicyCandidate: () => {},
    tokenUsage: [],
    isThinking: overrides?.isThinking ?? false,
    setInputHistory: () => {
      calls.setInputHistory += 1;
    },
    setInputHistoryIndex: () => {},
    setInputHistoryDraft: () => {},
    setIsThinking: () => {},
    setThinkingLabel: () => {},
    setTokenUsage: () => {},
    createMessage,
    nowIso: () => DEFAULT_TIME,
    setInterrupt: () => {},
  });
  return { submit, rows, session, calls };
}
