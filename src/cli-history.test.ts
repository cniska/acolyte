import { describe, expect, test } from "bun:test";
import { historyMode } from "./cli-history";
import type { Session } from "./session-contract";
import type { SessionStore } from "./session-contract";
import { dedent } from "./test-utils";

type HistoryDeps = Parameters<typeof historyMode>[1];

function createMockStore(sessions: Session[] = []): SessionStore {
  return {
    async listSessions(options) {
      return options?.limit ? sessions.slice(0, options.limit) : sessions;
    },
    async getSession(id) {
      return sessions.find((s) => s.id === id) ?? null;
    },
    async saveSession() {},
    async removeSession() {},
    async getActiveSessionId() {
      return undefined;
    },
    async setActiveSessionId() {},
    close() {},
  };
}

function createDeps(overrides?: Partial<HistoryDeps>): { deps: HistoryDeps; output: () => string } {
  const lines: string[] = [];
  const deps: HistoryDeps = {
    hasHelpFlag: () => false,
    printDim: (message) => lines.push(message),
    getSessionStore: async () => createMockStore(),
    commandError: () => {},
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

describe("cli-history", () => {
  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: (name) => {
        expect(name).toBe("history");
        called = true;
      },
    });
    await historyMode([], deps);
    expect(called).toBe(true);
  });

  test("extra args calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (name) => {
        expect(name).toBe("history");
        called = true;
      },
    });
    await historyMode(["unexpected"], deps);
    expect(called).toBe(true);
  });

  test("empty store prints no saved sessions", async () => {
    const { deps, output } = createDeps();
    await historyMode([], deps);
    expect(output()).toBe("No saved sessions.");
  });

  test("sessions present prints formatted rows", async () => {
    const sessions: Session[] = [
      {
        id: "aaa",
        createdAt: "9999-01-01T00:00:00.000Z",
        updatedAt: "9999-01-01T00:00:00.000Z",
        title: "First session",
        model: "gpt-4",
        messages: [],
        tokenUsage: [],
      },
      {
        id: "bbb",
        createdAt: "9999-01-01T00:00:00.000Z",
        updatedAt: "9999-01-01T00:00:00.000Z",
        title: "Second session",
        model: "gpt-4",
        messages: [],
        tokenUsage: [],
      },
    ];
    const { deps, output } = createDeps({
      getSessionStore: async () => createMockStore(sessions),
    });
    await historyMode([], deps);
    expect(output()).toBe(
      dedent(`
        aaa  First session   just now
        bbb  Second session  just now
      `),
    );
  });

  test("--json outputs JSON lines", async () => {
    const sessions: Session[] = [
      {
        id: "aaa",
        createdAt: "9999-01-01T00:00:00.000Z",
        updatedAt: "9999-01-01T00:00:00.000Z",
        title: "First",
        model: "gpt-4",
        messages: [],
        tokenUsage: [],
      },
    ];
    const { deps, output } = createDeps({
      getSessionStore: async () => createMockStore(sessions),
    });
    await historyMode(["--json"], deps);
    const parsed = JSON.parse(output()) as Record<string, string>;
    expect(parsed.id).toBe("aaa");
    expect(parsed.title).toBe("First");
  });
});
