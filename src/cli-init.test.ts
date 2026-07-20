import { afterEach, describe, expect, test } from "bun:test";
import { initMode } from "./cli-init";
import type { ProviderApiEnvKey } from "./provider-contract";
import { dedent } from "./test-utils";

afterEach(() => {
  process.exitCode = 0;
});

type InitDeps = Parameters<typeof initMode>[1];

function createDeps(overrides?: Partial<InitDeps>): {
  deps: InitDeps;
  output: () => string;
  calls: string[];
  writes: Array<{ envKey: ProviderApiEnvKey; value: string }>;
} {
  const lines: string[] = [];
  const calls: string[] = [];
  const writes: Array<{ envKey: ProviderApiEnvKey; value: string }> = [];
  const deps: InitDeps = {
    hasHelpFlag: () => false,
    prompt: () => null,
    promptHidden: async () => "sk-new",
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(message),
    readProviderApiKeys: () => ({}),
    writeProviderApiKey: async (envKey, value) => {
      writes.push({ envKey, value });
    },
    credentialsPath: () => "/home/user/.acolyte/credentials",
    commandError: (name) => {
      calls.push(`commandError:${name}`);
    },
    commandHelp: (name) => {
      calls.push(`commandHelp:${name}`);
    },
    ...overrides,
  };
  return { deps, output: () => lines.join("\n"), calls, writes };
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
        Invalid provider. Use vercel, anthropic, google, or openai.
      `),
    );
  });

  test("existing key: declining the override leaves it unchanged", async () => {
    const { deps, output, writes } = createDeps({
      readProviderApiKeys: () => ({ OPENAI_API_KEY: "sk-existing" }),
      prompt: () => "n",
    });
    await initMode(["openai"], deps);
    expect(writes).toEqual([]);
    expect(output()).toContain("Left the existing key unchanged.");
  });

  test("existing key: confirming the override writes the new key", async () => {
    const { deps, writes } = createDeps({
      readProviderApiKeys: () => ({ AI_GATEWAY_API_KEY: "old" }),
      prompt: () => "y",
    });
    await initMode(["vercel"], deps);
    expect(writes).toEqual([{ envKey: "AI_GATEWAY_API_KEY", value: "sk-new" }]);
  });

  test("no existing key: writes without prompting for confirmation", async () => {
    let confirmAsked = false;
    const { deps, writes } = createDeps({
      prompt: () => {
        confirmAsked = true;
        return null;
      },
    });
    await initMode(["openai"], deps);
    expect(confirmAsked).toBe(false);
    expect(writes).toEqual([{ envKey: "OPENAI_API_KEY", value: "sk-new" }]);
  });
});
