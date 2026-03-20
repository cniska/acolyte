import { describe, expect, test } from "bun:test";
import { historyMode } from "./cli-history";
import { dedent } from "./test-utils";

type HistoryDeps = Parameters<typeof historyMode>[1];

function createDeps(overrides?: Partial<HistoryDeps>): { deps: HistoryDeps; output: () => string } {
  const lines: string[] = [];
  const deps: HistoryDeps = {
    hasHelpFlag: () => false,
    printDim: (message) => lines.push(message),
    readStore: async () => ({ activeSessionId: undefined, sessions: [] }),
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
    const { deps, output } = createDeps({
      readStore: async () => ({
        activeSessionId: undefined,
        sessions: [
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
        ],
      }),
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
    const { deps, output } = createDeps({
      readStore: async () => ({
        activeSessionId: undefined,
        sessions: [
          {
            id: "aaa",
            createdAt: "9999-01-01T00:00:00.000Z",
            updatedAt: "9999-01-01T00:00:00.000Z",
            title: "First",
            model: "gpt-4",
            messages: [],
            tokenUsage: [],
          },
        ],
      }),
    });
    await historyMode(["--json"], deps);
    const parsed = JSON.parse(output()) as Record<string, string>;
    expect(parsed.id).toBe("aaa");
    expect(parsed.title).toBe("First");
  });
});
