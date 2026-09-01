import { describe, expect, test } from "bun:test";
import { configMode } from "./cli-config";
import { setLocale } from "./i18n";

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
    printOutput: (message) => dimLines.push(message),
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

  test("list --json writes raw JSON without dim styling", async () => {
    const lines: string[] = [];
    const { deps } = createDeps({
      printDim: (message) => lines.push(`\x1b[2m${message}\x1b[22m`),
      printOutput: (message) => lines.push(message),
      readConfig: async () => ({ locale: "en" }),
    });
    await configMode(["list", "--json"], deps);
    const output = lines.join("\n");
    expect(output.startsWith("{")).toBe(true);
    expect(output.includes("\x1b[2m")).toBe(false);
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

  test("setting the locale confirms in the language just chosen", async () => {
    const { deps, dimLines } = createDeps();
    try {
      await configMode(["set", "locale", "sv"], deps);
      expect(dimLines.at(-1)).toBe("Inställningen locale sparades (user).");
    } finally {
      setLocale("en");
    }
  });

  test("unsetting the locale confirms in the default language", async () => {
    const { deps, dimLines } = createDeps();
    try {
      await configMode(["set", "locale", "sv"], deps);
      await configMode(["unset", "locale"], deps);
      expect(dimLines.at(-1)).toBe("Removed config locale (user).");
    } finally {
      setLocale("en");
    }
  });
});
