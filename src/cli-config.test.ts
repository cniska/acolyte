import { describe, expect, test } from "bun:test";
import { configMode } from "./cli-config";

type ConfigModeDeps = Parameters<typeof configMode>[1];

function createDeps(overrides?: Partial<ConfigModeDeps>): { deps: ConfigModeDeps; dimLines: string[]; errorLines: string[] } {
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
  test("list renders memorySources array on one row", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ memorySources: ["distill", "stored"] }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("memorySources:   distill, stored");
  });

  test("list still renders object maps as dotted rows", async () => {
    const { deps, dimLines } = createDeps({
      readConfig: async () => ({ models: { plan: "gpt-5-mini" } }),
    });
    await configMode(["list"], deps);
    expect(dimLines).toContain("models.plan:     gpt-5-mini");
  });
});
