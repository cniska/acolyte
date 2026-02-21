import { describe, expect, test } from "bun:test";
import { appConfig, setPermissionMode } from "./app-config";
import { type ChatRow, dispatchSlashCommand, formatTokenUsageOutput, type TokenUsageEntry } from "./chat-commands";
import { createBackend, createMessage, createSession, createStore } from "./test-factory";

async function runCommand(
  text: string,
  tokenUsage: TokenUsageEntry[] = [],
  store = createStore(),
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
  });

  test("dispatchSlashCommand handles /changes", async () => {
    const { rows, stop } = await runCommand("/changes");
    expect(stop).toBe(true);
    const assistant = [...rows].reverse().find((row) => row.role === "assistant");
    expect(assistant).toBeDefined();
    expect((assistant?.content ?? "").trim().length).toBeGreaterThan(0);
  });

  test("dispatchSlashCommand validates /web usage", async () => {
    const { rows, stop } = await runCommand("/web");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /web <query>")).toBe(true);
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
