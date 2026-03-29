import { describe, expect, test } from "bun:test";
import { runMode } from "./cli-run";

type RunDeps = Parameters<typeof runMode>[1];

function createRunDeps(): { deps: RunDeps; calls: { errors: string[]; dims: string[] } } {
  const calls = { errors: [] as string[], dims: [] as string[] };
  const deps: RunDeps = {
    apiUrlForPort: (port) => `http://127.0.0.1:${port}`,
    appModel: "openai/gpt-5-mini",
    attachFileToSession: async () => undefined as never,
    createClient: () => ({}) as never,
    createSession: (model?: string) =>
      ({ id: "sess_123", title: "run", createdAt: "", updatedAt: "", messages: [], tokenUsage: [], model }) as never,
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    hasHelpFlag: (args) => args.includes("--help"),
    handlePrompt: async () => true,
    printDim: (line: string) => calls.dims.push(line),
    printError: (msg: string) => calls.errors.push(msg),
    readResolvedConfigSync: () => ({ replyTimeoutMs: 0 }) as never,
    runResourceId: (_id: string) => "run:1" as never,
    serverApiKey: "",
    serverEntry: "",
    serverPort: 6767,
    commandError: () => undefined,
    commandHelp: () => undefined,
  };
  return { deps, calls };
}

describe("cli-run --model flag", () => {
  test("overrides appModel when --model is provided", async () => {
    const { deps } = createRunDeps();
    let seenModel: string | undefined;
    deps.createSession = (model?: string) => {
      seenModel = model;
      return { id: "sess_123", title: "run", createdAt: "", updatedAt: "", messages: [], tokenUsage: [] } as never;
    };

    // ensure no leftover exit code
    const prevExit = process.exitCode;
    process.exitCode = 0;

    await runMode(["--model", "anthropic/claude-sonnet-4", "do something"], deps);

    expect(seenModel).toEqual("anthropic/claude-sonnet-4");

    process.exitCode = prevExit;
  });

  test("prints error when --model is missing a value", async () => {
    const { deps, calls } = createRunDeps();
    const prevExit = process.exitCode;
    process.exitCode = 0;

    await runMode(["--model"], deps);

    expect(calls.errors).toContain("--model requires a model id");
    expect(process.exitCode).toBe(1);

    process.exitCode = prevExit;
  });
});
