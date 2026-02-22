import { describe, expect, test } from "bun:test";
import { appConfig, setPermissionMode } from "./app-config";
import { type ChatRow, dispatchSlashCommand, formatTokenUsageOutput, type TokenUsageEntry } from "./chat-commands";
import { createBackend, createMessage, createSession, createStore } from "./test-factory";

async function runCommand(
  text: string,
  tokenUsage: TokenUsageEntry[] = [],
  store = createStore(),
  options?: {
    memoryApi?: {
      listMemories: () => Promise<Array<{ id: string; scope: "user" | "project"; content: string; createdAt: string }>>;
      addMemory: (
        content: string,
        options?: { scope?: "user" | "project" },
      ) => Promise<{ id: string; scope: "user" | "project"; content: string; createdAt: string }>;
      getMemoryContextEntries?: () => Promise<
        Array<{ id: string; scope: "user" | "project"; content: string; createdAt: string }>
      >;
    };
  },
): Promise<{ rows: ChatRow[]; stop: boolean; openedPermissions: boolean; openedPolicy: number }> {
  let rows: ChatRow[] = [];
  let openedPermissions = false;
  let openedPolicy = 0;
  const result = await dispatchSlashCommand({
    text,
    resolvedText: text,
    backend: createBackend(),
    store,
    currentSession: createSession(),
    setCurrentSession: () => {},
    toRows: () => [],
    setRows: (updater) => {
      rows = updater(rows);
    },
    setShowShortcuts: () => {},
    setValue: () => {},
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    openPermissionsPanel: () => {
      openedPermissions = true;
    },
    openPolicyPanel: () => {
      openedPolicy += 1;
    },
    setBackendPermissionMode: async () => {},
    tokenUsage,
    memoryApi: options?.memoryApi,
  });
  return { rows, stop: result.stop, openedPermissions, openedPolicy };
}

describe("chat-commands", () => {
  test("formatTokenUsageOutput renders aligned rows", () => {
    const usage: TokenUsageEntry = {
      id: "row_1",
      usage: {
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
        promptBudgetTokens: 300,
        promptTruncated: false,
      },
    };
    const output = formatTokenUsageOutput(usage, [usage]);
    expect(output).toContain("last_turn:");
    expect(output).toContain("session:");
    expect(output).toContain("budget:");
  });

  test("formatTokenUsageOutput includes latest warning when present", () => {
    const usage: TokenUsageEntry = {
      id: "row_warn",
      usage: {
        promptTokens: 900,
        completionTokens: 40,
        totalTokens: 940,
        promptBudgetTokens: 1000,
        promptTruncated: true,
      },
      warning: "context trimmed (8/42 history messages)",
    };
    const output = formatTokenUsageOutput(usage, [usage]);
    expect(output).toContain("warning:");
    expect(output).toContain("context trimmed (8/42 history messages)");
  });

  test("formatTokenUsageOutput shows latest session warning even when last turn has none", () => {
    const warned: TokenUsageEntry = {
      id: "row_warned",
      usage: {
        promptTokens: 950,
        completionTokens: 30,
        totalTokens: 980,
      },
      warning: "context near budget (950/1000 tokens)",
    };
    const clean: TokenUsageEntry = {
      id: "row_clean",
      usage: {
        promptTokens: 200,
        completionTokens: 20,
        totalTokens: 220,
      },
    };
    const output = formatTokenUsageOutput(clean, [warned, clean]);
    expect(output).toContain("warning:");
    expect(output).toContain("context near budget (950/1000 tokens)");
  });

  test("dispatchSlashCommand handles /tokens", async () => {
    const tokenUsage: TokenUsageEntry[] = [
      {
        id: "row_2",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
    ];
    const { rows, stop } = await runCommand("/tokens", tokenUsage);

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("last_turn:"))).toBe(true);
  });

  test("dispatchSlashCommand handles /tokens with empty usage", async () => {
    const { rows, stop } = await runCommand("/tokens");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No token data yet. Send a prompt first.")).toBe(true);
  });

  test("dispatchSlashCommand returns transformed prompt for /dogfood", async () => {
    const result = await dispatchSlashCommand({
      text: "/dogfood tighten output",
      resolvedText: "/dogfood tighten output",
      backend: createBackend(),
      store: createStore(),
      currentSession: createSession(),
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: () => {},
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      setBackendPermissionMode: async () => {},
      tokenUsage: [],
    });

    expect(result.stop).toBe(false);
    expect(result.runVerifyAfterReply).toBe(true);
    expect(result.userText.startsWith("Dogfood mode:")).toBe(true);
  });

  test("dispatchSlashCommand suggests /skills for /skill typo", async () => {
    const { rows, stop } = await runCommand("/skill");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Did you mean /skills?"))).toBe(true);
  });

  test("dispatchSlashCommand suggests /dogfood for removed /compact aliases", async () => {
    const { rows, stop } = await runCommand("/compact refactor chat output");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Did you mean /dogfood?"))).toBe(true);
  });

  test("dispatchSlashCommand suggests nearest command for general typo", async () => {
    const { rows, stop } = await runCommand("/stauts");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Did you mean /status?"))).toBe(true);
  });

  test("dispatchSlashCommand handles /status", async () => {
    const { rows, stop } = await runCommand("/status");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content.includes("provider:"))).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content.includes("memory_context:"))).toBe(true);
  });

  test("dispatchSlashCommand handles /sessions with compact assistant output", async () => {
    const store = createStore({
      activeSessionId: "sess_aaaa1111",
      sessions: [
        createSession({ id: "sess_aaaa1111", title: "First" }),
        createSession({ id: "sess_bbbb2222", title: "Second" }),
      ],
    });
    const { rows, stop } = await runCommand("/sessions", [], store);
    expect(stop).toBe(true);
    const assistant = rows.find((row) => row.role === "assistant" && row.content.includes("Sessions 2"));
    expect(assistant).toBeDefined();
    expect(assistant?.style).toBe("sessionsList");
    expect(assistant?.content).toContain("● sess_aaaa111  First");
    expect(assistant?.content).toContain("  sess_bbbb222  Second");
  });

  test("dispatchSlashCommand handles /distill", async () => {
    const store = createStore({
      sessions: [
        createSession({
          messages: [
            createMessage("user", "we should keep output concise"),
            createMessage("user", "please we should keep output concise"),
          ],
        }),
      ],
    });
    const { rows, stop, openedPolicy } = await runCommand("/distill --sessions 10 --min 2", [], store);
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Proposed policy updates"))).toBe(true);
    expect(rows.some((row) => row.content.includes("keep output concise"))).toBe(true);
    expect(openedPolicy).toBe(1);
  });

  test("dispatchSlashCommand handles /memory with empty store", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "No memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles scoped /memory with empty store", async () => {
    let receivedScope = "";
    const memoryApi = {
      listMemories: async (options?: { scope?: "all" | "user" | "project" }) => {
        receivedScope = options?.scope ?? "all";
        return [];
      },
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [],
    };
    const { rows, stop } = await runCommand("/memory user", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("user");
    expect(rows.some((row) => row.role === "assistant" && row.content === "No user memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory context with empty context", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [],
    };
    const { rows, stop } = await runCommand("/memory context", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(
      rows.some((row) => row.role === "assistant" && row.content === "No memory context is currently injected."),
    ).toBe(true);
  });

  test("dispatchSlashCommand handles /memory context with entries", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [
        {
          id: "mem_1",
          scope: "project" as const,
          content: "use bun run verify before commit",
          createdAt: "2026-02-21T00:00:05.000Z",
        },
        {
          id: "mem_2",
          scope: "user" as const,
          content: "keep output concise",
          createdAt: "2026-02-21T00:00:03.000Z",
        },
      ],
    };
    const { rows, stop } = await runCommand("/memory context", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    const assistant = rows.find((row) => row.role === "assistant" && row.content.startsWith("Memory context 2"));
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("project: use bun run verify before commit");
    expect(assistant?.content).toContain("user: keep output concise");
  });

  test("dispatchSlashCommand handles /memory context scope filtering", async () => {
    let receivedScope = "";
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async (options?: { scope?: "all" | "user" | "project" }) => {
        receivedScope = options?.scope ?? "all";
        return [];
      },
    };
    const { rows, stop } = await runCommand("/memory context user", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("user");
    expect(
      rows.some((row) => row.role === "assistant" && row.content === "No user memory context is currently injected."),
    ).toBe(true);
  });

  test("dispatchSlashCommand validates /memory context scope", async () => {
    const { rows, stop } = await runCommand("/memory context foo");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /memory context [all|user|project]")).toBe(true);
  });

  test("dispatchSlashCommand validates /memory context extra args", async () => {
    const { rows, stop } = await runCommand("/memory context all extra");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /memory context [all|user|project]")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory with entries", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
        {
          id: "mem_2",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    const assistant = rows.find((row) => row.role === "assistant" && row.content.startsWith("Memory 2"));
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("user: prefer concise output");
    expect(assistant?.content).toContain("project: use bun scripts");
  });

  test("dispatchSlashCommand handles explicit /memory all scope", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
        {
          id: "mem_2",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [],
    };
    const { rows, stop } = await runCommand("/memory all", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    const assistant = rows.find((row) => row.role === "assistant" && row.content.startsWith("Memory 2"));
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("user: prefer concise output");
    expect(assistant?.content).toContain("project: use bun scripts");
  });

  test("dispatchSlashCommand renders scoped /memory header", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [],
    };
    const { rows, stop } = await runCommand("/memory user", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content.startsWith("User memory 1"))).toBe(true);
  });

  test("dispatchSlashCommand renders scoped /memory context header", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      getMemoryContextEntries: async () => [
        {
          id: "mem_2",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
        },
      ],
    };
    const { rows, stop } = await runCommand("/memory context project", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content.startsWith("Project memory context 1"))).toBe(
      true,
    );
  });

  test("dispatchSlashCommand validates /memory scope usage", async () => {
    const { rows, stop } = await runCommand("/memory foo");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /memory [all|user|project|context [all|user|project]]")).toBe(
      true,
    );
  });

  test("dispatchSlashCommand handles /remember and saves selected scope", async () => {
    let savedContent = "";
    let savedScope = "";
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async (content: string, options?: { scope?: "user" | "project" }) => {
        const scope = options?.scope ?? "user";
        savedContent = content;
        savedScope = scope;
        return {
          id: "mem_3",
          scope,
          content,
          createdAt: "2026-02-21T00:00:02.000Z",
        };
      },
    };
    const { rows, stop } = await runCommand("/remember --project use bun verify", [], createStore(), { memoryApi });
    expect(stop).toBe(true);
    expect(savedContent).toBe("use bun verify");
    expect(savedScope).toBe("project");
    expect(rows.some((row) => row.role === "assistant" && row.content === "Saved project memory: use bun verify")).toBe(
      true,
    );
  });

  test("dispatchSlashCommand shows permission mode", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const { rows, stop, openedPermissions } = await runCommand("/permissions");
      expect(stop).toBe(true);
      expect(openedPermissions).toBe(true);
      expect(rows.some((row) => row.role === "user" && row.content === "/permissions")).toBe(true);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand applies /permissions read|write", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const readResult = await runCommand("/permissions read");
      expect(readResult.stop).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe("read");
      expect(readResult.rows.some((row) => row.content === "permission mode: read")).toBe(true);

      const writeResult = await runCommand("/permissions write");
      expect(writeResult.stop).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe("write");
      expect(writeResult.rows.some((row) => row.content === "permission mode: write")).toBe(true);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand validates /permissions usage", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const { rows, stop } = await runCommand("/permissions maybe");
      expect(stop).toBe(true);
      expect(rows.some((row) => row.content === "Usage: /permissions [read|write]")).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe(prev);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand /new resets rows to new-session status", async () => {
    let rows: ChatRow[] = [{ id: "old", role: "assistant", content: "old row" }];
    const session = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [session], activeSessionId: session.id });
    const setCurrentSessionCalls: string[] = [];

    const result = await dispatchSlashCommand({
      text: "/new",
      resolvedText: "/new",
      backend: createBackend(),
      store,
      currentSession: session,
      setCurrentSession: (next) => {
        setCurrentSessionCalls.push(next.id);
      },
      toRows: () => [],
      setRows: (updater) => {
        rows = updater(rows);
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      setBackendPermissionMode: async () => {},
      tokenUsage: [],
    });

    expect(result.stop).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: "user", content: "/new" });
    expect(rows[1]?.role).toBe("assistant");
    expect(rows[1]?.content.startsWith("Started new session: sess_")).toBe(true);
    expect(rows[1]?.style).toBe("sessionStatus");
    expect(setCurrentSessionCalls).toHaveLength(1);
    expect(store.sessions).toHaveLength(2);
    expect(store.activeSessionId).toBe(setCurrentSessionCalls[0]);
  });

  test("dispatchSlashCommand /resume with prefix restores matching session", async () => {
    let rows: ChatRow[] = [];
    const target = createSession({
      id: "sess_resume_target",
      title: "Resume Target",
      messages: [createMessage("assistant", "hi")],
    });
    const store = createStore({
      sessions: [target, createSession({ id: "sess_other", title: "Other" })],
      activeSessionId: "sess_other",
    });
    const setCurrentSessionCalls: string[] = [];

    const result = await dispatchSlashCommand({
      text: `/resume ${target.id.slice(0, 12)}`,
      resolvedText: `/resume ${target.id.slice(0, 12)}`,
      backend: createBackend(),
      store,
      currentSession: createSession({ id: "sess_current" }),
      setCurrentSession: (next) => {
        setCurrentSessionCalls.push(next.id);
      },
      toRows: (messages) => messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      setRows: (updater) => {
        rows = updater(rows);
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      setBackendPermissionMode: async () => {},
      tokenUsage: [],
    });

    expect(result.stop).toBe(true);
    expect(store.activeSessionId).toBe(target.id);
    expect(setCurrentSessionCalls).toEqual([target.id]);
    expect(rows.some((row) => row.style === "sessionStatus" && row.content.startsWith("Resumed session:"))).toBe(true);
  });

  test("dispatchSlashCommand /resume opens picker flow", async () => {
    const { rows, stop } = await runCommand("/resume");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "user" && row.content === "/resume")).toBe(true);
  });

  test("dispatchSlashCommand /resume with missing prefix reports not found", async () => {
    const { rows, stop } = await runCommand("/resume missing");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No session found for prefix: missing")).toBe(true);
  });

  test("dispatchSlashCommand supports /new then /resume round-trip", async () => {
    let rows: ChatRow[] = [];
    const original = createSession({
      id: "sess_original",
      title: "Original Session",
      messages: [createMessage("assistant", "orig")],
    });
    const store = createStore({
      sessions: [original],
      activeSessionId: original.id,
    });
    let current = original;

    const baseCtx = {
      backend: createBackend(),
      store,
      setCurrentSession: (next: ReturnType<typeof createSession>) => {
        current = next;
      },
      toRows: (messages: ReturnType<typeof createSession>["messages"]) =>
        messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
      setRows: (updater: (currentRows: ChatRow[]) => ChatRow[]) => {
        rows = updater(rows);
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      setBackendPermissionMode: async () => {},
      tokenUsage: [] as TokenUsageEntry[],
    };

    const newResult = await dispatchSlashCommand({
      text: "/new",
      resolvedText: "/new",
      currentSession: current,
      ...baseCtx,
    });
    expect(newResult.stop).toBe(true);
    const createdId = store.activeSessionId ?? "";
    expect(createdId.startsWith("sess_")).toBe(true);
    expect(createdId).not.toBe(original.id);

    const resumeResult = await dispatchSlashCommand({
      text: `/resume ${original.id.slice(0, 12)}`,
      resolvedText: `/resume ${original.id.slice(0, 12)}`,
      currentSession: current,
      ...baseCtx,
    });
    expect(resumeResult.stop).toBe(true);
    expect(store.activeSessionId).toBe(original.id);
    expect(current.id).toBe(original.id);
  });
});
