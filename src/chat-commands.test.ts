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
});
