import { describe, expect, test } from "bun:test";
import { configMode } from "./cli-config";

type ConfigModeDeps = Parameters<typeof configMode>[1];

function createDeps(overrides?: Partial<ConfigModeDeps>): {
  deps: ConfigModeDeps;
  dimLines: string[];
  errorLines: string[];
} {
  const dimLines: string[] = [];
  const errorLines: string[] = [];
  const deps: ConfigModeDeps = {
    hasHelpFlag: () => false,
    printDim: (message) => dimLines.push(message),
    printError: (message) => errorLines.push(message),
    readConfig: async () => ({}),
    readConfigForScope: async () => ({}),
    setConfigValue: async () => {},
    commandError: () => {},
    commandHelp: () => {},
    unsetConfigValue: async () => {},
    ...overrides,
  };
  return { deps, dimLines, errorLines };
}

describe("cli config", () => {
  test("list renders locale scalar key", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ locale: "en" }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("locale:  en");
  });

  test("list renders replyTimeoutMs scalar key", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ replyTimeoutMs: 30000 }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("replyTimeoutMs:  30000");
  });

  test("unset forwards key", async () => {
    const calls: Array<{ key: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      unsetConfigValue: async (key, options) => {
        calls.push({ key, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["unset", "reasoning"], deps);
    expect(calls).toEqual([{ key: "reasoning", scope: "user" }]);
  });

  test("unset accepts trailing scope flag", async () => {
    const calls: Array<{ key: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      unsetConfigValue: async (key, options) => {
        calls.push({ key, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["unset", "reasoning", "--project"], deps);
    expect(calls).toEqual([{ key: "reasoning", scope: "project" }]);
  });

  test("set accepts trailing scope flag", async () => {
    const calls: Array<{ key: string; value: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      setConfigValue: async (key, value, options) => {
        calls.push({ key, value, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["set", "reasoning", "high", "--project"], deps);
    expect(calls).toEqual([{ key: "reasoning", value: "high", scope: "project" }]);
  });
});
