import type { Backend, StreamEvent } from "./backend";
import type { ChatRow, CommandContext, TokenUsageEntry } from "./chat-commands";
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

export function createBackend(overrides?: {
  reply?: Backend["reply"];
  replyStream?: Backend["replyStream"];
  status?: Backend["status"];
  events?: StreamEvent[];
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
      const events = overrides?.events;
      if (events) {
        for (const event of events) {
          options.onEvent(event);
        }
      }
      return reply(input, { signal: options.signal });
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
    setProgressText: () => {},
    setTokenUsage: () => {},
    createMessage,
    nowIso: () => DEFAULT_TIME,
    setInterrupt: () => {},
  });
  return { submit, rows, session, calls };
}

export type CommandContextSpies = {
  rows: ChatRow[];
  openedPermissions: boolean;
  openedPolicy: number;
  currentSessionIds: string[];
  tokenUsageSets: TokenUsageEntry[][];
};

export function createCommandContext(
  text: string,
  overrides: Partial<CommandContext> = {},
): { ctx: CommandContext; spies: CommandContextSpies } {
  const spies: CommandContextSpies = {
    rows: [],
    openedPermissions: false,
    openedPolicy: 0,
    currentSessionIds: [],
    tokenUsageSets: [],
  };
  const ctx: CommandContext = {
    text,
    resolvedText: text,
    backend: createBackend(),
    store: createStore(),
    currentSession: createSession(),
    setCurrentSession: (next) => {
      spies.currentSessionIds.push(next.id);
    },
    setTokenUsage: (updater) => {
      spies.tokenUsageSets.push(updater([]));
    },
    toRows: (messages) => messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
    setRows: (updater) => {
      spies.rows = updater(spies.rows);
    },
    setShowShortcuts: () => {},
    setValue: () => {},
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openPermissionsPanel: () => {
      spies.openedPermissions = true;
    },
    openPolicyPanel: () => {
      spies.openedPolicy += 1;
    },
    setBackendPermissionMode: async () => {},
    tokenUsage: [],
    ...overrides,
  };
  return { ctx, spies };
}
