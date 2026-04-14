import { expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatResponse } from "./api";
import type { CommandContext } from "./chat-commands-contract";
import type { ChatMessage, ChatRow } from "./chat-contract";
import { createMessageHandler } from "./chat-message-handler";
import { type CreatePickerHandlersInput, createPickerHandlers } from "./chat-picker-handlers";
import type { Client, PendingState, StreamEvent } from "./client-contract";
import { createErrorStats } from "./error-handling";
import { DEFAULT_FEATURE_FLAGS } from "./feature-flags-contract";
import type { LifecycleDeps } from "./lifecycle";
import type { LifecycleInput, RunContext } from "./lifecycle-contract";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import type { Toolset } from "./tool-registry";
import { createSessionContext } from "./tool-session";

export function mockFetch(handler: (...args: Parameters<typeof fetch>) => Promise<Response>): {
  fn: ReturnType<typeof mock>;
  restore: () => void;
} {
  const previous = globalThis.fetch;
  const fn = mock(handler);
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, restore: () => (globalThis.fetch = previous) };
}

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

export function tempDb<T extends { close(): void }>(
  prefix: string,
  factory: (dbPath: string) => T,
): { create: () => T; cleanup: () => void } {
  const { createDir, cleanupDirs } = tempDir();
  const stores: T[] = [];
  return {
    create() {
      const dir = createDir(prefix);
      const store = factory(join(dir, "test.db"));
      stores.push(store);
      return store;
    },
    cleanup() {
      for (const store of stores.splice(0, stores.length)) store.close();
      cleanupDirs();
    },
  };
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
    for (let i = 1; i < valueOrStrings.length; i++) out += String(rest[i - 1] ?? "") + valueOrStrings[i];
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

export function normalizeIntentText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function expectIntent(text: string, checks: string[][]): void {
  const value = normalizeIntentText(text);
  for (const fragments of checks) {
    for (const fragment of fragments) {
      expect(value).toContain(normalizeIntentText(fragment));
    }
  }
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
  for (let i = 0; i < attempts; i++) {
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
    workspace: overrides.workspace,
    workspaceName: overrides.workspaceName,
    workspaceBranch: overrides.workspaceBranch,
    messages: overrides.messages ?? [],
    tokenUsage: overrides.tokenUsage ?? [],
  };
}

export function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
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
  replyStream?: Client["replyStream"];
  status?: Client["status"];
  events?: StreamEvent[];
  taskStatus?: Client["taskStatus"];
}): Client {
  const replyStream =
    overrides?.replyStream ??
    (async (input) => {
      const events = overrides?.events;
      if (events) {
        for (const event of events) {
          input.onEvent(event);
        }
      }
      return { model: "gpt-5-mini", output: "ok", state: "done" as const };
    });
  return {
    replyStream,
    status: overrides?.status ?? (async () => ({ providers: ["openai"], model: "gpt-5-mini" })),
    taskStatus: overrides?.taskStatus ?? (async () => null),
  };
}

export type MessageHandlerHarness = {
  handleMessage: (raw: string) => Promise<void>;
  rows: ChatRow[];
  /** Every row that was ever present, even after clearTranscript. */
  allRows: ChatRow[];
  session: Session;
  sessionState: SessionState;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowHelp: Array<boolean | ((current: boolean) => boolean)>;
    pendingStates: Array<PendingState | null>;
    pendingTransitions: boolean[];
    setCurrentSessionIds: string[];
    tokenUsageSnapshots: SessionTokenUsageEntry[][];
  };
  interrupt: {
    registered: boolean;
    fire: () => void;
  };
};

export function createMessageHandlerHarness(overrides?: {
  isPending?: boolean;
  client?: Client;
  session?: Session;
  sessionState?: SessionState;
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
    pendingStates: [] as Array<PendingState | null>,
    pendingTransitions: [] as boolean[],
    setCurrentSessionIds: [] as string[],
    tokenUsageSnapshots: [] as SessionTokenUsageEntry[][],
  };
  const session = overrides?.session ?? createSession({ id: "sess_test" });
  const sessionState =
    overrides?.sessionState ?? createSessionState({ activeSessionId: session.id, sessions: [session] });
  const tokenUsage = overrides?.tokenUsage ?? session.tokenUsage ?? [];
  const { handleSubmit: handleMessage } = createMessageHandler({
    client: overrides?.client ?? createClient({ status: async () => ({}) }),
    sessionState,
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
    isPending: overrides?.isPending ?? false,
    setInputHistory: () => {
      calls.setInputHistory += 1;
    },
    setInputHistoryIndex: () => {},
    setInputHistoryDraft: () => {},
    onStartPending: () => {
      calls.pendingTransitions.push(true);
    },
    onStopPending: () => {
      calls.pendingTransitions.push(false);
    },
    setPendingState: (next) => {
      calls.pendingStates.push(next);
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
  return { handleMessage, rows, allRows, session, sessionState, calls, interrupt };
}

export type PickerHandlerSpies = {
  rows: ChatRow[];
  pickerValues: unknown[];
  currentSessions: Session[];
  rowsDirectSets: ChatRow[][];
  assistantTurnTexts: string[];
  persistCalls: number;
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
    persistCalls: 0,
  };
  const handlers = createPickerHandlers({
    sessionState: createSessionState(),
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
    persist: async () => {
      spies.persistCalls++;
    },
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
  currentSessionIds: string[];
  tokenUsageSets: SessionTokenUsageEntry[][];
  persistCalls: number;
};

export function createLifecycleDeps(overrides?: Partial<LifecycleDeps>): LifecycleDeps {
  return {
    resolveModel: () => ({ model: "gpt-5-mini", provider: "openai" }),
    createLifecyclePolicy: () => ({
      ...defaultLifecyclePolicy,
      initialMaxSteps: 3,
      stepTimeoutMs: 1000,
      totalMaxSteps: 12,
      maxNudgesPerGeneration: 1,
    }),
    phasePrepare: mock(() => ({
      session: createSessionContext(),
      tools: {} as unknown as Toolset,
      baseAgentInput: "BASE_INPUT",
      promptUsage: {
        inputTokens: 0,
        inputBudgetTokens: 8000,
        systemPromptTokens: 0,
        toolTokens: 0,
        memoryTokens: 0,
        messageTokens: 0,
        inputTruncated: false,
        includedHistoryMessages: 0,
        totalHistoryMessages: 0,
      },
    })),
    createRunAgent: mock(() => ({
      id: "test-agent",
      name: "test-agent",
      instructions: "",
      model: {} as never,
      tools: {},
      async stream() {
        throw new Error("createRunAgent stream should not be called in unit test");
      },
    })),
    phaseGenerate: mock(async (ctx: { result?: unknown }) => {
      ctx.result = { text: "Generated output", toolCalls: [], signal: "done" };
    }),
    phaseFinalize: mock(
      (ctx: { result?: { text: string } }): ChatResponse => ({
        state: "done",
        model: "gpt-5-mini",
        output: ctx.result?.text ?? "",
      }),
    ),
    ...overrides,
  };
}

export function createLifecycleInput(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [], useMemory: false },
    soulPrompt: "",
    features: DEFAULT_FEATURE_FLAGS,
    ...overrides,
  };
}

export function createRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    request: { model: "gpt-5-mini", message: "test", history: [] },
    workspace: undefined,
    taskId: undefined,
    soulPrompt: "",
    features: DEFAULT_FEATURE_FLAGS,
    emit: () => {},
    debug: () => {},
    tools: {} as RunContext["tools"],
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
    observedTools: new Set(),
    modelCallCount: 1,
    inputTokensAccum: 0,
    outputTokensAccum: 0,
    promptBreakdownTotals: createEmptyPromptBreakdownTotals(),
    streamingChars: 0,
    lastUsageEmitChars: 0,
    errorStats: createErrorStats(),
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
    persistCalls: 0,
  };
  const ctx: CommandContext = {
    text,
    resolvedText: text,
    client: createClient(),
    sessionState: createSessionState(),
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
    persist: async () => {
      spies.persistCalls++;
    },
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openModelPanel: () => {
      spies.openedModel = true;
    },
    clearTranscript: () => {
      spies.rows = [];
    },
    tokenUsage: [],
    ...overrides,
  };
  return { ctx, spies };
}
