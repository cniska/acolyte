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
    subcommandErrors: string[];
    toolResults: string[];
    runCommands: string[];
  };
} {
  const calls = {
    attach: [] as string[],
    help: [] as string[],
    errors: [] as string[],
    dims: [] as string[],
    subcommandErrors: [] as string[],
    toolResults: [] as string[],
    runCommands: [] as string[],
  };
  const deps: RunDeps = {
    appModel: "openai/gpt-5-mini",
    attachFileToSession: async (_session, path) => {
      calls.attach.push(path);
    },
    createClient: () => ({}) as never,
    createSession: () => ({ id: "sess_123", title: "run", createdAt: "", updatedAt: "", messages: [] }) as never,
    cwd: () => "/tmp/work",
    ensureLocalServer: async () => ({ apiUrl: "http://127.0.0.1:6767", managed: false, started: false }),
    formatForTool: () => "formatted",
    formatLocalServerReadyMessage: () => "ready",
    hasHelpFlag: (args) => args.includes("--help"),
    handlePrompt: async () => true,
    newMessage: (role, content) => ({ role, content }) as never,
    parseRunExitCode: () => 0,
    printDim: (message) => calls.dims.push(message),
    printError: (message) => calls.errors.push(message),
    readResolvedConfigSync: () => ({ replyTimeoutMs: 1234 }) as never,
    resolveChatApiUrl: () => "http://127.0.0.1:6767",
    runResourceId: () => "user_123",
    runShellCommand: async (_cwd, command) => {
      calls.runCommands.push(command);
      return "ok";
    },
    serverApiKey: "key",
    serverApiUrl: "http://127.0.0.1:6767",
    serverEntry: "src/server.ts",
    serverPort: 6767,
    shouldAutoStartLocalServerForChat: () => false,
    showToolResult: (title) => calls.toolResults.push(title),
    subcommandError: (name) => calls.subcommandErrors.push(name),
    subcommandHelp: (name) => calls.help.push(name),
  };
  return { deps, calls };
}

describe("cli-run", () => {
  test("runResourceId derives stable isolated key", () => {
    expect(runResourceId("sess_abcdef1234567890")).toBe("user_run-abcdef1234567890");
    expect(runResourceId("sess_short")).toBe("user_run-short");
  });

  test("shows subcommand help when help flag is present", async () => {
    const { deps, calls } = createRunDeps();
    await runMode(["--help"], deps);
    expect(calls.help).toEqual(["run"]);
    expect(calls.subcommandErrors).toEqual([]);
  });

  test("runs verify command when --verify is enabled", async () => {
    const { deps, calls } = createRunDeps();
    await runMode(["--verify", "hello"], deps);
    expect(calls.runCommands).toEqual(["bun run verify"]);
    expect(calls.toolResults).toEqual(["Run"]);
  });
});
