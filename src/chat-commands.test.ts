import { describe, expect, test } from "bun:test";
import type { Backend } from "./backend";
import { type ChatRow, dispatchSlashCommand, formatTokenUsageOutput, type TokenUsageEntry } from "./chat-commands";
import type { Session, SessionStore } from "./types";

function makeSession(id = "sess_test001"): Session {
  return {
    id,
    createdAt: "2026-02-20T10:00:00.000Z",
    updatedAt: "2026-02-20T10:00:00.000Z",
    model: "gpt-5-mini",
    title: "New Session",
    messages: [],
  };
}

function makeStore(): SessionStore {
  return {
    activeSessionId: "sess_test001",
    sessions: [makeSession("sess_test001"), makeSession("sess_test002")],
  };
}

function makeBackend(): Backend {
  return {
    async reply() {
      return { model: "gpt-5-mini", output: "ok" };
    },
    async status() {
      return "provider=local model=gpt-5-mini";
    },
  };
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
    let rows: ChatRow[] = [];
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
    const result = await dispatchSlashCommand({
      text: "/tokens",
      resolvedText: "/tokens",
      backend: makeBackend(),
      store: makeStore(),
      currentSession: makeSession(),
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
      tokenUsage,
    });

    expect(result.stop).toBe(true);
    expect(rows.some((row) => row.content.includes("last_turn:"))).toBe(true);
  });

  test("dispatchSlashCommand returns transformed prompt for /dogfood", async () => {
    const result = await dispatchSlashCommand({
      text: "/dogfood tighten output",
      resolvedText: "/dogfood tighten output",
      backend: makeBackend(),
      store: makeStore(),
      currentSession: makeSession(),
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: () => {},
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      tokenUsage: [],
    });

    expect(result.stop).toBe(false);
    expect(result.runVerifyAfterReply).toBe(true);
    expect(result.userText.startsWith("Dogfood mode:")).toBe(true);
  });

  test("dispatchSlashCommand suggests /skills for /skill typo", async () => {
    let rows: ChatRow[] = [];
    const result = await dispatchSlashCommand({
      text: "/skill",
      resolvedText: "/skill",
      backend: makeBackend(),
      store: makeStore(),
      currentSession: makeSession(),
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
      tokenUsage: [],
    });

    expect(result.stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Did you mean /skills?"))).toBe(true);
  });

  test("dispatchSlashCommand suggests /dogfood for removed /compact aliases", async () => {
    let rows: ChatRow[] = [];
    const result = await dispatchSlashCommand({
      text: "/compact refactor chat output",
      resolvedText: "/compact refactor chat output",
      backend: makeBackend(),
      store: makeStore(),
      currentSession: makeSession(),
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
      tokenUsage: [],
    });

    expect(result.stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Did you mean /dogfood?"))).toBe(true);
  });
});
