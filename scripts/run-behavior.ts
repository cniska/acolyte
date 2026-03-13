import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  BEHAVIOR_SCENARIO_BY_ID,
  BEHAVIOR_SCENARIO_LIST,
  parseBehaviorScenarioId,
  type BehaviorScenarioId,
} from "./behavior-scenarios";
import { PERF_COMMAND_TIMEOUT_MS, runTimedCommand, toPrettyJson } from "./perf-test-utils";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = PERF_COMMAND_TIMEOUT_MS;
const REPO_DIR = join(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_DIR, "src", "cli.ts");

const behaviorOutputSchema = z.object({
  scenarioId: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1),
  workspace: z.string().min(1),
  expectedChanges: z.array(z.string().min(1)).min(1),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export type BehaviorArgs = {
  model: string;
  scenarioIds: BehaviorScenarioId[];
  keepWorkspaces: boolean;
  json: boolean;
  timeoutMs: number;
};

type BehaviorRun = z.infer<typeof behaviorOutputSchema>;

function parseInteger(token: string | undefined, flag: string): number {
  if (!token) throw new Error(`Missing value for ${flag}`);
  const value = Number(token);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid value for ${flag}: ${token}`);
  return value;
}

export function parseArgs(args: string[]): BehaviorArgs {
  let model = DEFAULT_MODEL;
  let keepWorkspaces = false;
  let json = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const scenarioIds: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--model") {
      model = args[i + 1] ?? "";
      if (model.trim().length === 0) throw new Error("Missing value for --model");
      i += 1;
      continue;
    }
    if (token === "--scenario") {
      scenarioIds.push(parseBehaviorScenarioId(args[i + 1] ?? ""));
      i += 1;
      continue;
    }
    if (token === "--keep-workspaces") {
      keepWorkspaces = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--timeout-ms") {
      timeoutMs = parseInteger(args[i + 1], "--timeout-ms");
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    model,
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : BEHAVIOR_SCENARIO_LIST.map((scenario) => scenario.id),
    keepWorkspaces,
    json,
    timeoutMs,
  };
}

function printUsage(): void {
  console.log(
    "Usage: bun run scripts/run-behavior.ts [--model <id>] [--scenario <id>] [--keep-workspaces] [--json] [--timeout-ms <n>]",
  );
}

async function createBehaviorWorkspace(scenarioId: BehaviorScenarioId): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `acolyte-behavior-${scenarioId}-`));
  await mkdir(workspace, { recursive: true });
  return workspace;
}

async function runScenario(scenarioId: BehaviorScenarioId, model: string, timeoutMs: number): Promise<BehaviorRun> {
  const scenario = BEHAVIOR_SCENARIO_BY_ID[scenarioId];
  const workspace = await createBehaviorWorkspace(scenario.id);
  await scenario.setup(workspace);

  const result = await runTimedCommand(
    ["bun", "run", CLI_ENTRY, "run", "--workspace", workspace, "--model", model, scenario.prompt],
    { ...process.env, NO_COLOR: "1" } as Record<string, string>,
    timeoutMs,
    REPO_DIR,
  );

  return behaviorOutputSchema.parse({
    scenarioId: scenario.id,
    description: scenario.description,
    prompt: scenario.prompt,
    model,
    workspace,
    expectedChanges: scenario.expectedChanges,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

function printRun(run: BehaviorRun): void {
  console.log(`\n[${run.scenarioId}] ${run.description}`);
  console.log(`model: ${run.model}`);
  console.log(`workspace: ${run.workspace}`);
  console.log(`expected changes: ${run.expectedChanges.join(", ")}`);
  console.log(`exit: ${run.exitCode} (${Math.round(run.durationMs)}ms)`);
  if (run.stdout.trim().length > 0) console.log(run.stdout.trimEnd());
  if (run.stderr.trim().length > 0) console.error(run.stderr.trimEnd());
}

async function cleanup(runs: BehaviorRun[]): Promise<void> {
  await runTimedCommand(["bun", "run", CLI_ENTRY, "stop"], { ...process.env, NO_COLOR: "1" } as Record<string, string>, 10_000, REPO_DIR);
  for (const run of runs) await rm(run.workspace, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runs: BehaviorRun[] = [];

  try {
    for (const scenarioId of args.scenarioIds) runs.push(await runScenario(scenarioId, args.model, args.timeoutMs));
  } finally {
    if (!args.keepWorkspaces) await cleanup(runs);
  }

  if (args.json) {
    console.log(toPrettyJson(runs));
    return;
  }

  for (const run of runs) printRun(run);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
