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
    subcommandError: () => {},
    subcommandHelp: () => {},
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
    expect(dimLines).toContain("locale:          en");
  });

  test("list renders memorySources array on one row", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ memorySources: ["distill_session", "stored"] }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("memorySources:   distill_session, stored");
  });

  test("list still renders object maps as dotted rows", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ models: { plan: "gpt-5-mini" } }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("models.plan:     gpt-5-mini");
  });

  test("unset forwards dotted keys", async () => {
    const calls: Array<{ key: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      unsetConfigValue: async (key, options) => {
        calls.push({ key, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["unset", "models.plan"], deps);
    expect(calls).toEqual([{ key: "models.plan", scope: "user" }]);
  });

  test("unset accepts trailing scope flag", async () => {
    const calls: Array<{ key: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      unsetConfigValue: async (key, options) => {
        calls.push({ key, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["unset", "models.plan", "--project"], deps);
    expect(calls).toEqual([{ key: "models.plan", scope: "project" }]);
  });

  test("set accepts trailing scope flag", async () => {
    const calls: Array<{ key: string; value: string; scope: "user" | "project" }> = [];
    const { deps } = createDeps({
      setConfigValue: async (key, value, options) => {
        calls.push({ key, value, scope: options?.scope ?? "user" });
      },
    });
    await configMode(["set", "models.plan", "gpt-5-mini", "--project"], deps);
    expect(calls).toEqual([{ key: "models.plan", value: "gpt-5-mini", scope: "project" }]);
  });
});
