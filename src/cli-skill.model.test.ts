import { describe, expect, test } from "bun:test";
import { parseSkillArgs, skillMode } from "./cli-skill";

type SkillDeps = Parameters<typeof skillMode>[1];

function createSkillDeps(): { deps: SkillDeps; calls: { errors: string[]; dims: string[] } } {
  const calls = { errors: [] as string[], dims: [] as string[] };
  const deps: SkillDeps = {
    apiUrlForPort: (port) => `http://127.0.0.1:${port}`,
    appModel: "openai/gpt-5-mini",
    attachFileToSession: async () => undefined as never,
    compactText: (t) => t,
    createClient: () => ({}) as never,
    createMessage: (_role: string, _content: string) => ({}) as never,
    createSession: (model?: string) =>
      ({ id: "sess_123", title: "skill", createdAt: "", updatedAt: "", messages: [], tokenUsage: [], model }) as never,
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    findSkillByName: (_name: string) => ({ name: "foo", path: "." }) as never,
    handlePrompt: async () => true,
    hasHelpFlag: (args) => args.includes("--help"),
    loadSkills: async () => undefined as never,
    printDim: (line: string) => calls.dims.push(line),
    printError: (msg: string) => calls.errors.push(msg),
    readResolvedConfigSync: () => ({ replyTimeoutMs: 0 }) as never,
    readSkillInstructions: async () => "do the thing",
    serverApiKey: "",
    serverEntry: "",
    serverPort: 6767,
    skillBudget: {},
    commandError: () => undefined,
    commandHelp: () => undefined,
  };
  return { deps, calls };
}

describe("cli-skill --model flag", () => {
  test("parseSkillArgs parses --model correctly", () => {
    const parsed = parseSkillArgs(["--model", "anthropic/claude-sonnet-4", "skill-name", "do something"]);
    expect(parsed.model).toEqual("anthropic/claude-sonnet-4");
  });

  test("skillMode passes the model to createSession when --model is provided", async () => {
    const { deps } = createSkillDeps();
    let seenModel: string | undefined;
    deps.createSession = (model?: string) => {
      seenModel = model;
      return { id: "sess_123", title: "skill", createdAt: "", updatedAt: "", messages: [], tokenUsage: [] } as never;
    };

    // ensure no leftover exit code
    const prevExit = process.exitCode;
    process.exitCode = 0;

    await skillMode(["--model", "anthropic/claude-sonnet-4", "skill-name", "do something"], deps);

    expect(seenModel).toEqual("anthropic/claude-sonnet-4");

    process.exitCode = prevExit;
  });

  test("skillMode uses appModel when --model is not provided", async () => {
    const { deps } = createSkillDeps();
    let seenModel: string | undefined;
    deps.createSession = (model?: string) => {
      seenModel = model;
      return { id: "sess_123", title: "skill", createdAt: "", updatedAt: "", messages: [], tokenUsage: [] } as never;
    };

    // ensure no leftover exit code
    const prevExit = process.exitCode;
    process.exitCode = 0;

    await skillMode(["skill-name", "do something"], deps);

    expect(seenModel).toEqual("openai/gpt-5-mini");

    process.exitCode = prevExit;
  });

  test("skillMode does not disable verifier", async () => {
    const { deps } = createSkillDeps();
    let seenOptions: { resourceId?: string; workspace?: string; verifyScope?: string } | undefined;
    deps.handlePrompt = async (_prompt, _session, _client, options) => {
      seenOptions = options as typeof seenOptions;
      return true;
    };

    const prevExit = process.exitCode;
    process.exitCode = 0;

    await skillMode(["skill-name", "do something"], deps);

    expect(seenOptions?.verifyScope).toBeUndefined();

    process.exitCode = prevExit;
  });
});
