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
    newMessage: (role, content) => ({ role, content }) as never,
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
    expect(runResourceId("sess_abcdef1234567890")).toBe("user_run-sess_abcdef1234567890");
    expect(runResourceId("sess_short")).toBe("user_run-sess_short");
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
        { id: "msg_1", usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, modelCalls: 2 },
        { id: "msg_2", usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 }, modelCalls: 1 },
      ],
    };
    deps.createSession = () => session as never;
    await runMode(["do something"], deps);
    const tokenLine = calls.dims.find((d) => d.startsWith("run:"));
    expect(tokenLine).toBeDefined();
    expect(tokenLine).toContain("430 tokens");
    expect(tokenLine).toContain("prompt 300");
    expect(tokenLine).toContain("completion 130");
    expect(tokenLine).toContain("3 model calls");
    expect(tokenLine).toContain("2 turns");
  });
});
