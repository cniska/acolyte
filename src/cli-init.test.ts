import { afterEach, describe, expect, test } from "bun:test";
import { initMode } from "./cli-init";
import { dedent } from "./test-utils";

afterEach(() => {
  process.exitCode = 0;
});

type InitDeps = Parameters<typeof initMode>[1];

function createDeps(overrides?: Partial<InitDeps>): { deps: InitDeps; output: () => string; calls: string[] } {
  const lines: string[] = [];
  const calls: string[] = [];
  const deps: InitDeps = {
    cwd: () => "/tmp/test",
    hasHelpFlag: () => false,
    prompt: () => null,
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(message),
    readFile: (async () => "") as never,
    writeFile: async () => undefined,
    commandError: (name) => {
      calls.push(`commandError:${name}`);
    },
    commandHelp: (name) => {
      calls.push(`commandHelp:${name}`);
    },
    ...overrides,
  };
  return { deps, output: () => lines.join("\n"), calls };
}

describe("cli-init", () => {
  test("help flag calls commandHelp", async () => {
    const { deps, calls } = createDeps({ hasHelpFlag: () => true });
    await initMode(["--help"], deps);
    expect(calls).toEqual(["commandHelp:init"]);
  });

  test("too many args calls commandError", async () => {
    const { deps, calls } = createDeps();
    await initMode(["openai", "extra"], deps);
    expect(calls).toEqual(["commandError:init"]);
  });

  test("invalid provider prints error", async () => {
    const { deps, output } = createDeps();
    await initMode(["invalid"], deps);
    expect(output()).toBe(
      dedent(`
        Invalid provider. Use vercel, openai, anthropic, or google.
      `),
    );
  });
});
