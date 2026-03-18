import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMode } from "./agent-contract";
import type { CommandContext } from "./chat-commands";
import type { ChatRow, ChatMessage } from "./chat-contract";
import { createMessageHandler } from "./chat-message-handler";
import { type CreatePickerHandlersInput, createPickerHandlers } from "./chat-picker-handlers";
import type { Client, StreamEvent } from "./client-contract";
import { createErrorStats } from "./error-handling";
import type { RunContext } from "./lifecycle-contract";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
import type { MemorySource } from "./memory-contract";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { createSessionContext } from "./tool-guards";

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

export function testUuid(): string {
  return Bun.randomUUIDv7();
}

export function dedentString(value: string): string {
  const lines = value.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]?.trim().length === 0) start += 1;
  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;
  if (start > end) return "";

  let prefix: string | null = null;
  for (const line of lines.slice(start, end + 1)) {
    if (line.trim().length === 0) continue;
    const current = line.match(/^[ \t]*/)?.[0] ?? "";
    if (prefix === null || current.length < prefix.length) prefix = current;
  }
  const normalizedPrefix = prefix ?? "";
  return lines
    .slice(start, end + 1)
    .map((line) => (line.startsWith(normalizedPrefix) ? line.slice(normalizedPrefix.length) : line))
    .join("\n");
}

export function dedent(value: string, gutter?: number): string;
export function dedent(strings: ReadonlyArray<string>, ...values: ReadonlyArray<unknown>): string;
export function dedent(
  valueOrStrings: string | ReadonlyArray<string>,
  ...rest: [number?] | ReadonlyArray<unknown>
): string {
  if (Array.isArray(valueOrStrings)) {
    let out = valueOrStrings[0] ?? "";
    for (let i = 1; i < valueOrStrings.length; i += 1) out += String(rest[i - 1] ?? "") + valueOrStrings[i];
    return dedentString(out);
  }
  if (typeof valueOrStrings !== "string") throw new Error("Invalid dedent input");
  const gutter = typeof rest[0] === "number" ? rest[0] : 0;
  const dedented = dedentString(valueOrStrings);
  if (gutter <= 0) return dedented;
  const pad = " ".repeat(gutter);
  return dedented
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${pad}${line}`))
    .join("\n");
}

function toJSONDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return toJSONDeep((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map(toJSONDeep);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) output[key] = toJSONDeep(nested);
  return output;
}

export function expectJSON(actual: unknown): {
  toDeepEqual: (expected: unknown) => void;
  toMatchObject: (expected: Record<string, unknown>) => void;
} {
  const actualJSON = toJSONDeep(actual);
  return {
    toDeepEqual(expected: unknown): void {
      expect(actualJSON).toEqual(toJSONDeep(expected));
    },
    toMatchObject(expected: Record<string, unknown>): void {
      expect(actualJSON).toMatchObject(toJSONDeep(expected) as Record<string, unknown>);
    },
  };
}

export function expectToThrowJSON(fn: () => unknown): {
  toDeepEqual: (expected: unknown) => void;
  toMatchObject: (expected: Record<string, unknown>) => void;
} {
  let thrown = false;
  let actual: unknown;
  try {
    fn();
  } catch (error) {
    thrown = true;
    actual = toJSONDeep(error);
  }
  if (!thrown) {
    throw new Error("Expected function to throw");
  }
  return {
    toDeepEqual(expected: unknown): void {
      expect(actual).toEqual(toJSONDeep(expected));
    },
    toMatchObject(expected: Record<string, unknown>): void {
      expect(actual).toMatchObject(toJSONDeep(expected) as Record<string, unknown>);
    },
  };
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
  const skillDir = join(base, ".agents", "skills", dirName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `${frontmatter}\n${body}`, "utf8");
}

const DEFAULT_TIME = "2026-02-20T00:00:00.000Z";

export function createMessage(
  role: ChatMessage["role"] = "user",
  content = "test",
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
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

export function createStore(overrides: Partial<SessionState> = {}): SessionState {
  const sessions = overrides.sessions ?? [
    createSession({ id: "sess_test001" }),
    createSession({ id: "sess_test002", title: "Second Session" }),
  ];
  return {
    activeSessionId: overrides.activeSessionId ?? sessions[0]?.id ?? "sess_test001",
    sessions,
  };
}

export function createMemorySource(id: string, entries: string[], onCommit?: () => void): MemorySource {
  return {
    id,
    async loadEntries() {
      return entries.map((content) => ({ content }));
    },
    commit: onCommit
      ? async () => {
          onCommit();
          return undefined;
        }
      : undefined,
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
    status: overrides?.status ?? (async () => ({ providers: ["openai"], model: "gpt-5-mini", permissions: "write" })),
    taskStatus: overrides?.taskStatus ?? (async () => null),
  };
}

export type MessageHandlerHarness = {
  handleMessage: (raw: string) => Promise<void>;
  rows: ChatRow[];
  /** Every row that was ever present, even after clearTranscript. */
  allRows: ChatRow[];
  session: Session;
  store: SessionState;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowHelp: Array<boolean | ((current: boolean) => boolean)>;
    progressTexts: Array<string | null>;
    thinkingTransitions: boolean[];
    setCurrentSessionIds: string[];
    tokenUsageSnapshots: SessionTokenUsageEntry[][];
  };
  interrupt: {
    registered: boolean;
    fire: () => void;
  };
};

export function createMessageHandlerHarness(overrides?: {
  isWorking?: boolean;
  client?: Client;
  session?: Session;
  store?: SessionState;
  tokenUsage?: SessionTokenUsageEntry[];
  toRows?: (messages: ChatMessage[]) => ChatRow[];
}): MessageHandlerHarness {
  const rows: ChatRow[] = [];
  const allRows: ChatRow[] = [];
  const interrupt = { registered: false, fire: () => {} };
  const calls = {
    setInputHistory: 0,
    setValue: [] as string[],
    setShowHelp: [] as Array<boolean | ((current: boolean) => boolean)>,
    progressTexts: [] as Array<string | null>,
    thinkingTransitions: [] as boolean[],
    setCurrentSessionIds: [] as string[],
    tokenUsageSnapshots: [] as SessionTokenUsageEntry[][],
  };
  const session = overrides?.session ?? createSession({ id: "sess_test" });
  const store = overrides?.store ?? createStore({ activeSessionId: session.id, sessions: [session] });
  const tokenUsage = overrides?.tokenUsage ?? session.tokenUsage ?? [];
  const { handleSubmit: handleMessage } = createMessageHandler({
    client: overrides?.client ?? createClient({ status: async () => ({}) }),
    store,
    currentSession: session,
    setCurrentSession: (next) => {
      calls.setCurrentSessionIds.push(next.id);
    },
    toRows: overrides?.toRows ?? (() => []),
    setRows: (updater) => {
      const next = updater(rows);
      rows.splice(0, rows.length, ...next);
      for (const row of next) {
        if (!allRows.includes(row)) allRows.push(row);
      }
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
    openModelPanel: () => {},
    tokenUsage,
    isWorking: overrides?.isWorking ?? false,
    setInputHistory: () => {
      calls.setInputHistory += 1;
    },
    setInputHistoryIndex: () => {},
    setInputHistoryDraft: () => {},
    setIsWorking: (next) => {
      calls.thinkingTransitions.push(next);
    },
    setProgressText: (next) => {
      calls.progressTexts.push(next);
    },
    setRunningUsage: () => {},
    setTokenUsage: (updater) => {
      calls.tokenUsageSnapshots.push(updater([]));
    },
    createMessage,
    nowIso: () => DEFAULT_TIME,
    setInterrupt: (handler) => {
      interrupt.registered = handler !== null;
      if (handler) interrupt.fire = handler;
    },
    clearTranscript: () => {
      rows.splice(0, rows.length);
    },
  });
  return { handleMessage, rows, allRows, session, store, calls, interrupt };
}

export type PickerHandlerSpies = {
  rows: ChatRow[];
  pickerValues: unknown[];
  currentSessions: Session[];
  rowsDirectSets: ChatRow[][];
  assistantTurnTexts: string[];
};

export function createPickerHandlerHarness(overrides?: Partial<CreatePickerHandlersInput>): {
  handlers: ReturnType<typeof createPickerHandlers>;
  spies: PickerHandlerSpies;
} {
  const spies: PickerHandlerSpies = {
    rows: [],
    pickerValues: [],
    currentSessions: [],
    rowsDirectSets: [],
    assistantTurnTexts: [],
  };
  const handlers = createPickerHandlers({
    store: createStore(),
    currentSession: createSession(),
    setCurrentSession: (next) => {
      spies.currentSessions.push(next);
    },
    setRows: (updater) => {
      const next = updater(spies.rows);
      spies.rows.length = 0;
      spies.rows.push(...next);
    },
    setRowsDirect: (next) => {
      spies.rowsDirectSets.push(next);
    },
    setPicker: (next) => {
      spies.pickerValues.push(next);
    },
    setShowHelp: () => {},
    setValue: () => {},
    persist: async () => {},
    toRows: () => [],
    nowIso: () => "2026-02-20T00:00:00.000Z",
    activateSkill: async () => true,
    startAssistantTurn: async (text) => {
      spies.assistantTurnTexts.push(text);
    },
    clearTranscript: () => {},
    ...overrides,
  });
  return { handlers, spies };
}

export type CommandContextSpies = {
  rows: ChatRow[];
  openedModel: boolean;
  openedModelMode?: AgentMode;
  currentSessionIds: string[];
  tokenUsageSets: SessionTokenUsageEntry[][];
};

export function createRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [] },
    workspace: undefined,
    taskId: undefined,
    soulPrompt: "",
    emit: () => {},
    debug: () => {},
    initialMode: "work",
    tools: {} as RunContext["tools"],
    mode: "work",
    agentForMode: "work",
    model: "gpt-5-mini",
    session: createSessionContext(),
    agent: {} as RunContext["agent"],
    baseAgentInput: "test prompt",
    policy: defaultLifecyclePolicy,
    promptUsage: {
      inputTokens: 0,
      systemPromptTokens: 0,
      toolTokens: 0,
      memoryTokens: 0,
      messageTokens: 0,
      inputBudgetTokens: 8000,
      inputTruncated: false,
      includedHistoryMessages: 0,
      totalHistoryMessages: 0,
    },
    lifecycleState: { feedback: [], verifyOutcome: undefined, repeatedFailure: undefined },
    observedTools: new Set(),
    modelCallCount: 1,
    inputTokensAccum: 0,
    outputTokensAccum: 0,
    promptBreakdownTotals: createEmptyPromptBreakdownTotals(),
    streamingChars: 0,
    lastUsageEmitChars: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    errorStats: createErrorStats(),
    nativeIdQueue: new Map(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
    ...overrides,
  };
}

export function createCommandContext(
  text: string,
  overrides: Partial<CommandContext> = {},
): { ctx: CommandContext; spies: CommandContextSpies } {
  const spies: CommandContextSpies = {
    rows: [],
    openedModel: false,
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
    toRows: (messages) => messages.map((m) => ({ id: m.id, kind: m.role, content: m.content })),
    setRows: (updater) => {
      spies.rows = updater(spies.rows);
    },
    setShowHelp: () => {},
    setValue: () => {},
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openModelPanel: (mode?: AgentMode) => {
      spies.openedModel = true;
      spies.openedModelMode = mode;
    },
    clearTranscript: () => {
      spies.rows = [];
    },
    tokenUsage: [],
    ...overrides,
  };
  return { ctx, spies };
}
