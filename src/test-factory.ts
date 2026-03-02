import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appConfig, setPermissionMode } from "./app-config";
import type { ChatRow, CommandContext, TokenUsageEntry } from "./chat-commands";
import { createSubmitHandler } from "./chat-submit-handler";
import type { Client, StreamEvent } from "./client";
import type { Message, Session, SessionStore } from "./types";

export function tempDir(): { createDir: (prefix: string) => string; cleanupDirs: () => void } {
  const dirs: string[] = [];
  return {
    createDir(prefix: string): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
    cleanupDirs() {
      for (const dir of dirs.splice(0, dirs.length)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function dedent(value: string, gutter = 0): string {
  const lines = value.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]?.trim().length === 0) start += 1;
  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;
  if (start > end) return "";

  const indent = lines
    .slice(start, end + 1)
    .filter((line) => line.trim().length > 0)
    .reduce((min, line) => {
      const current = line.match(/^ */)?.[0].length ?? 0;
      return Math.min(min, current);
    }, Number.POSITIVE_INFINITY);
  const prefix = " ".repeat(indent);

  const dedented = lines
    .slice(start, end + 1)
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .join("\n");
  if (gutter <= 0) return dedented;
  const pad = " ".repeat(gutter);
  return dedented
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

export function startTestServer(fetch: (req: Request) => Response | Promise<Response>): {
  port: number;
  stop: () => void;
} {
  const attempts = 25;
  for (let i = 0; i < attempts; i += 1) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    try {
      const server = Bun.serve({ port, fetch });
      return { port: server.port ?? port, stop: () => server.stop(true) };
    } catch {
      // Retry with another random port.
    }
  }
  throw new Error("Unable to start test server after multiple attempts.");
}

export function writeSkill(base: string, dirName: string, frontmatter: string, body = ""): void {
  const skillDir = join(base, "skills", dirName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `${frontmatter}\n${body}`, "utf8");
}

export function savedPermissionMode(): () => void {
  const prev = appConfig.agent.permissions.mode;
  return () => setPermissionMode(prev);
}

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

export function createClient(overrides?: {
  reply?: (
    input: Parameters<Client["replyStream"]>[0],
    options?: { signal?: AbortSignal },
  ) => ReturnType<Client["replyStream"]>;
  replyStream?: Client["replyStream"];
  status?: Client["status"];
  events?: StreamEvent[];
  setPermissionMode?: Client["setPermissionMode"];
  taskStatus?: Client["taskStatus"];
}): Client {
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
    replyStream,
    status: overrides?.status ?? (async () => ({ provider: "local", model: "gpt-5-mini", permissions: "write" })),
    setPermissionMode: overrides?.setPermissionMode ?? (async () => {}),
    taskStatus: overrides?.taskStatus ?? (async () => null),
  };
}

export type SubmitHandlerHarness = {
  submit: (raw: string) => Promise<void>;
  rows: ChatRow[];
  session: Session;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowHelp: Array<boolean | ((current: boolean) => boolean)>;
  };
};

export function createSubmitHandlerHarness(overrides?: {
  isWorking?: boolean;
  client?: Client;
  session?: Session;
  store?: SessionStore;
  tokenUsage?: TokenUsageEntry[];
}): SubmitHandlerHarness {
  const rows: ChatRow[] = [];
  const calls = {
    setInputHistory: 0,
    setValue: [] as string[],
    setShowHelp: [] as Array<boolean | ((current: boolean) => boolean)>,
  };
  const session = overrides?.session ?? createSession({ id: "sess_test" });
  const store = overrides?.store ?? createStore({ activeSessionId: session.id, sessions: [session] });
  const tokenUsage = overrides?.tokenUsage ?? session.tokenUsage ?? [];
  const submit = createSubmitHandler({
    client: overrides?.client ?? createClient({ status: async () => ({}) }),
    store,
    currentSession: session,
    setCurrentSession: () => {},
    toRows: () => [],
    setRows: (updater) => {
      rows.splice(0, rows.length, ...updater(rows));
    },
    setShowHelp: (next) => {
      calls.setShowHelp.push(next);
    },
    setValue: (next) => {
      calls.setValue.push(next);
    },
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    activateSkill: async () => true,
    openResumePanel: () => {},
    openPermissionsPanel: () => {},
    openClarifyPanel: () => {},
    openWriteConfirmPanel: () => {},
    tokenUsage,
    isWorking: overrides?.isWorking ?? false,
    setInputHistory: () => {
      calls.setInputHistory += 1;
    },
    setInputHistoryIndex: () => {},
    setInputHistoryDraft: () => {},
    setIsWorking: () => {},
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
    currentSessionIds: [],
    tokenUsageSets: [],
  };
  const ctx: CommandContext = {
    text,
    resolvedText: text,
    client: createClient(),
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
    setShowHelp: () => {},
    setValue: () => {},
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openPermissionsPanel: () => {
      spies.openedPermissions = true;
    },
    setServerPermissionMode: async () => {},
    tokenUsage: [],
    ...overrides,
  };
  return { ctx, spies };
}
