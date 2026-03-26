import { describe, expect, test } from "bun:test";
import { toolMode } from "./cli-tool";

type ToolDeps = Parameters<typeof toolMode>[1];

function createDeps(overrides?: Partial<ToolDeps>): { deps: ToolDeps; errors: () => string[] } {
  const errors: string[] = [];
  const deps: ToolDeps = {
    hasHelpFlag: () => false,
    printError: (msg) => errors.push(msg),
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, errors: () => errors };
}

describe("cli-tool", () => {
  test("unknown tool prints usage", async () => {
    const { deps, errors } = createDeps();
    await toolMode(["nonexistent"], deps);
    expect(process.exitCode).toBe(1);
    expect(errors().length).toBeGreaterThan(0);
    process.exitCode = 0;
  });

  test("no arguments prints usage", async () => {
    const { deps, errors } = createDeps();
    await toolMode([], deps);
    expect(process.exitCode).toBe(1);
    expect(errors().length).toBeGreaterThan(0);
    process.exitCode = 0;
  });

  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: () => {
        called = true;
      },
    });
    await toolMode(["find-files", "*.ts"], deps);
    expect(called).toBe(true);
  });
});
