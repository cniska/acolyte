import { describe, expect, test } from "bun:test";
import { runMode, runResourceId } from "./cli-run";

type RunDeps = Parameters<typeof runMode>[1];

function createRunDeps(): {
  deps: RunDeps;
  calls: {
    attach: string[];
    help: string[];
    errors: string[];
    dims: string[];
    commandErrors: string[];
  };
} {
  const calls = {
    attach: [] as string[],
    help: [] as string[],
    errors: [] as string[],
    dims: [] as string[],
    commandErrors: [] as string[],
  };
  const deps: RunDeps = {
    apiUrlForPort: (port) => `http://127.0.0.1:${port}`,
    appModel: "openai/gpt-5-mini",
    attachFileToSession: async (_session, path) => {
      calls.attach.push(path);
    },
    createClient: () => ({}) as never,
    createSession: () =>
      ({ id: "sess_123", title: "run", createdAt: "", updatedAt: "", messages: [], tokenUsage: [] }) as never,
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    hasHelpFlag: (args) => args.includes("--help"),
    handlePrompt: async () => true,
    printDim: (message) => calls.dims.push(message),
    printError: (message) => calls.errors.push(message),
    readResolvedConfigSync: () => ({ replyTimeoutMs: 1234 }) as never,
    runResourceId: () => "user_123",
    serverApiKey: "key",
    serverEntry: "src/server.ts",
    serverPort: 6767,
    commandError: (name) => calls.commandErrors.push(name),
    commandHelp: (name) => calls.help.push(name),
  };
  return { deps, calls };
}

describe("cli-run", () => {
  test("runResourceId derives stable isolated key", () => {
    expect(runResourceId("sess_abcdef1234567890")).toBe("user_e3ccbbd21bfe");
    expect(runResourceId("sess_short")).toBe("user_2bd28255b8f6");
  });

  test("shows subcommand help when help flag is present", async () => {
    const { deps, calls } = createRunDeps();
    await runMode(["--help"], deps);
    expect(calls.help).toEqual(["run"]);
    expect(calls.commandErrors).toEqual([]);
  });

  test("prints token usage summary after run", async () => {
    const { deps, calls } = createRunDeps();
    const session = {
      id: "sess_123",
      title: "run",
      createdAt: "",
      updatedAt: "",
      messages: [],
      tokenUsage: [
        { id: "msg_1", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, modelCalls: 2 },
        { id: "msg_2", usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 }, modelCalls: 1 },
      ],
    };
    deps.createSession = () => session as never;
    await runMode(["do something"], deps);
    const tokenLine = calls.dims.find((d) => d.startsWith("run:"));
    expect(tokenLine).toBeDefined();
    expect(tokenLine).toContain("430 tokens");
    expect(tokenLine).toContain("input 300");
    expect(tokenLine).toContain("output 130");
    expect(tokenLine).toContain("3 calls");
  });

  test("runMode does not disable verifier", async () => {
    const { deps } = createRunDeps();
    let seenOptions: { resourceId?: string; workspace?: string; verifyScope?: string } | undefined;
    deps.handlePrompt = async (_prompt, _session, _client, options) => {
      seenOptions = options as typeof seenOptions;
      return true;
    };

    await runMode(["do something"], deps);

    expect(seenOptions?.verifyScope).toBeUndefined();
  });

  test("runMode does not inject a separate system prompt", async () => {
    const { deps } = createRunDeps();
    const session = {
      id: "sess_123",
      title: "run",
      createdAt: "",
      updatedAt: "",
      messages: [],
      tokenUsage: [],
    };
    deps.createSession = () => session as never;
    let seenSession: unknown;
    deps.handlePrompt = async (_prompt, currentSession) => {
      seenSession = currentSession;
      return true;
    };

    await runMode(["do something"], deps);

    expect(seenSession).toBe(session);
    expect(session.messages).toEqual([]);
  });
});
