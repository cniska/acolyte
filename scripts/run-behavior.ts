import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  BEHAVIOR_SCENARIO_BY_ID,
  BEHAVIOR_SCENARIO_LIST,
  type BehaviorScenarioId,
  parseBehaviorScenarioId,
} from "./behavior-scenarios";
import { runTimedCommand, toPrettyJson } from "./perf-test-utils";

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_TIMEOUT_MS = 60_000;
const REPO_DIR = join(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_DIR, "src", "cli.ts");
const DAEMON_LOG_PATH = join(homedir(), ".acolyte", "daemons", "6767.log");

const behaviorTraceSummarySchema = z.object({
  taskId: z.string().min(1).optional(),
  modelCalls: z.number().int().nonnegative().optional(),
  totalToolCalls: z.number().int().nonnegative().optional(),
  uniqueToolCount: z.number().int().nonnegative().optional(),
  readCalls: z.number().int().nonnegative().optional(),
  searchCalls: z.number().int().nonnegative().optional(),
  writeCalls: z.number().int().nonnegative().optional(),
  preWriteDiscoveryCalls: z.number().int().nonnegative().optional(),
  regenerationCount: z.number().int().nonnegative().optional(),
  regenerationLimitHit: z.boolean().optional(),
  guardBlockedCount: z.number().int().nonnegative().optional(),
  guardFlagSetCount: z.number().int().nonnegative().optional(),
  hasError: z.boolean().optional(),
  lastErrorCategory: z.string().min(1).optional(),
  timeoutErrorCount: z.number().int().nonnegative().optional(),
  fileNotFoundErrorCount: z.number().int().nonnegative().optional(),
  guardBlockedErrorCount: z.number().int().nonnegative().optional(),
  otherErrorCount: z.number().int().nonnegative().optional(),
});

const behaviorAnalysisSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: z.enum(["strong", "mixed", "weak"]),
  reasons: z.array(z.string().min(1)),
});

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
  trace: behaviorTraceSummarySchema.optional(),
  analysis: behaviorAnalysisSchema,
});

export type BehaviorArgs = {
  model: string;
  scenarioIds: BehaviorScenarioId[];
  keepWorkspaces: boolean;
  json: boolean;
  timeoutMs: number;
};

type BehaviorRun = z.infer<typeof behaviorOutputSchema>;

function parseField(line: string, key: string): string | undefined {
  const quoted = line.match(new RegExp(`(?:^|\\s)${key}="((?:[^"\\\\]|\\\\.)*)"`));
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return plain?.[1];
}

function parseTaskId(line: string): string | undefined {
  const value = parseField(line, "task_id");
  return value && value !== "null" ? value : undefined;
}

function parseIntField(line: string, key: string): number | undefined {
  const raw = parseField(line, key);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseBooleanField(line: string, key: string): boolean | undefined {
  const raw = parseField(line, key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function countMatching(lines: string[], pattern: string): number {
  return lines.filter((line) => line.includes(pattern)).length;
}

function countToolCalls(taskLines: string[], toolNames: string[]): number {
  return taskLines.filter(
    (line) =>
      line.includes("event=lifecycle.tool.call") && toolNames.some((toolName) => line.includes(`tool=${toolName}`)),
  ).length;
}

async function readLogLines(): Promise<string[]> {
  try {
    const raw = await readFile(DAEMON_LOG_PATH, "utf8");
    return raw.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function summarizeTrace(lines: string[]): z.infer<typeof behaviorTraceSummarySchema> | undefined {
  const taskId = [...lines]
    .reverse()
    .map((line) => parseTaskId(line))
    .find((value) => value && value.length > 0);
  if (!taskId) return undefined;
  const taskLines = lines.filter((line) => line.includes(`task_id=${taskId}`));
  const summaryLine = [...taskLines].reverse().find((line) => line.includes("event=lifecycle.summary"));
  if (!summaryLine) {
    return behaviorTraceSummarySchema.parse({
      taskId,
      modelCalls: countMatching(taskLines, "event=lifecycle.generate.start"),
      totalToolCalls: countMatching(taskLines, "event=lifecycle.tool.call"),
      uniqueToolCount: undefined,
      readCalls: countToolCalls(taskLines, ["read-file"]),
      searchCalls: countToolCalls(taskLines, [
        "find-files",
        "search-files",
        "scan-code",
        "git-status",
        "git-diff",
        "git-log",
        "git-show",
      ]),
      writeCalls: countToolCalls(taskLines, [
        "edit-file",
        "edit-code",
        "create-file",
        "delete-file",
        "git-add",
        "git-commit",
      ]),
      regenerationCount: taskLines.filter(
        (line) => line.includes("event=lifecycle.eval.decision") && line.includes("action=regenerate"),
      ).length,
      regenerationLimitHit: parseBooleanField(taskLines[taskLines.length - 1] ?? "", "regeneration_limit_hit"),
      guardBlockedCount: countMatching(taskLines, "event=lifecycle.guard"),
      guardFlagSetCount: 0,
      hasError: countMatching(taskLines, "event=lifecycle.error") > 0,
      lastErrorCategory: undefined,
      timeoutErrorCount: undefined,
      fileNotFoundErrorCount: undefined,
      guardBlockedErrorCount: undefined,
      otherErrorCount: undefined,
    });
  }
  return behaviorTraceSummarySchema.parse({
    taskId,
    modelCalls: parseIntField(summaryLine, "model_calls"),
    totalToolCalls: parseIntField(summaryLine, "tool_calls"),
    uniqueToolCount: parseIntField(summaryLine, "unique_tool_count"),
    readCalls: parseIntField(summaryLine, "read_calls"),
    searchCalls: parseIntField(summaryLine, "search_calls"),
    writeCalls: parseIntField(summaryLine, "write_calls"),
    preWriteDiscoveryCalls: parseIntField(summaryLine, "pre_write_discovery_calls"),
    regenerationCount: parseIntField(summaryLine, "regeneration_count"),
    regenerationLimitHit: parseBooleanField(summaryLine, "regeneration_limit_hit"),
    guardBlockedCount: parseIntField(summaryLine, "guard_blocked_count"),
    guardFlagSetCount: parseIntField(summaryLine, "guard_flag_set_count"),
    hasError: parseBooleanField(summaryLine, "has_error"),
    lastErrorCategory: parseField(summaryLine, "last_error_category"),
    timeoutErrorCount: parseIntField(summaryLine, "timeout_error_count"),
    fileNotFoundErrorCount: parseIntField(summaryLine, "file_not_found_error_count"),
    guardBlockedErrorCount: parseIntField(summaryLine, "guard_blocked_error_count"),
    otherErrorCount: parseIntField(summaryLine, "other_error_count"),
  });
}

export function analyzeBehavior(run: {
  exitCode: number;
  expectedChangeCount: number;
  trace?: z.infer<typeof behaviorTraceSummarySchema>;
}): z.infer<typeof behaviorAnalysisSchema> {
  let score = 1;
  const reasons: string[] = [];
  const trace = run.trace;

  if (run.exitCode !== 0) {
    score -= 0.3;
    reasons.push("run exited non-zero");
  }
  if (trace?.hasError) {
    score -= 0.2;
    reasons.push("lifecycle reported an error");
  }
  if ((trace?.guardBlockedCount ?? 0) > 0) {
    score -= Math.min(0.2, (trace?.guardBlockedCount ?? 0) * 0.05);
    reasons.push(`guard blocks: ${trace?.guardBlockedCount}`);
  }
  if ((trace?.regenerationCount ?? 0) > 0) {
    score -= Math.min(0.2, (trace?.regenerationCount ?? 0) * 0.1);
    reasons.push(`regenerations: ${trace?.regenerationCount}`);
  }
  if (trace?.regenerationLimitHit) {
    score -= 0.2;
    reasons.push("regeneration cap hit");
  }
  if ((trace?.preWriteDiscoveryCalls ?? 0) > 2) {
    score -= Math.min(0.15, ((trace?.preWriteDiscoveryCalls ?? 0) - 2) * 0.05);
    reasons.push(`excess pre-write discovery: ${trace?.preWriteDiscoveryCalls}`);
  }
  if ((trace?.searchCalls ?? 0) > 1) {
    score -= Math.min(0.1, ((trace?.searchCalls ?? 0) - 1) * 0.05);
    reasons.push(`search-heavy run: ${trace?.searchCalls}`);
  }
  if ((trace?.writeCalls ?? 0) > run.expectedChangeCount + 1) {
    score -= Math.min(0.1, ((trace?.writeCalls ?? 0) - (run.expectedChangeCount + 1)) * 0.03);
    reasons.push(`extra writes beyond expected scope: ${trace?.writeCalls}`);
  }
  if ((trace?.guardFlagSetCount ?? 0) > 0) {
    score -= Math.min(0.1, (trace?.guardFlagSetCount ?? 0) * 0.03);
    reasons.push(`guard flags: ${trace?.guardFlagSetCount}`);
  }
  if ((trace?.timeoutErrorCount ?? 0) > 0) {
    score -= Math.min(0.15, (trace?.timeoutErrorCount ?? 0) * 0.1);
    reasons.push(`timeout errors: ${trace?.timeoutErrorCount}`);
  }
  if ((trace?.fileNotFoundErrorCount ?? 0) > 0) {
    score -= Math.min(0.1, (trace?.fileNotFoundErrorCount ?? 0) * 0.05);
    reasons.push(`file-not-found errors: ${trace?.fileNotFoundErrorCount}`);
  }
  if ((trace?.guardBlockedErrorCount ?? 0) > 0) {
    score -= Math.min(0.1, (trace?.guardBlockedErrorCount ?? 0) * 0.05);
    reasons.push(`guard-blocked errors: ${trace?.guardBlockedErrorCount}`);
  }
  if ((trace?.otherErrorCount ?? 0) > 0) {
    score -= Math.min(0.1, (trace?.otherErrorCount ?? 0) * 0.05);
    reasons.push(`other errors: ${trace?.otherErrorCount}`);
  }
  if ((trace?.modelCalls ?? 0) > Math.max(4, run.expectedChangeCount + 2)) {
    score -= Math.min(0.1, ((trace?.modelCalls ?? 0) - Math.max(4, run.expectedChangeCount + 2)) * 0.02);
    reasons.push(`excess model calls: ${trace?.modelCalls}`);
  }

  const normalized = Math.max(0, Number(score.toFixed(2)));
  const verdict = normalized >= 0.85 ? "strong" : normalized >= 0.6 ? "mixed" : "weak";
  if (reasons.length === 0) reasons.push("clean bounded run");
  return behaviorAnalysisSchema.parse({ score: normalized, verdict, reasons });
}

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
  const beforeLines = await readLogLines();

  const result = await runTimedCommand(
    ["bun", "run", CLI_ENTRY, "run", "--workspace", workspace, "--model", model, scenario.prompt],
    { ...process.env, NO_COLOR: "1" } as Record<string, string>,
    timeoutMs,
    REPO_DIR,
  );
  const afterLines = await readLogLines();
  const trace = summarizeTrace(afterLines.slice(beforeLines.length));

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
    trace,
    analysis: analyzeBehavior({
      exitCode: result.exitCode,
      expectedChangeCount: scenario.expectedChanges.length,
      trace,
    }),
  });
}

function printRun(run: BehaviorRun): void {
  console.log(`\n[${run.scenarioId}] ${run.description}`);
  console.log(`model: ${run.model}`);
  console.log(`workspace: ${run.workspace}`);
  console.log(`expected changes: ${run.expectedChanges.join(", ")}`);
  console.log(`exit: ${run.exitCode} (${Math.round(run.durationMs)}ms)`);
  console.log(`score: ${run.analysis.score.toFixed(2)} (${run.analysis.verdict})`);
  if (run.trace) {
    console.log(
      `trace: task=${run.trace.taskId ?? "unknown"} model_calls=${run.trace.modelCalls ?? "?"} total_tools=${run.trace.totalToolCalls ?? "?"} unique_tools=${run.trace.uniqueToolCount ?? "?"} read=${run.trace.readCalls ?? "?"} search=${run.trace.searchCalls ?? "?"} write=${run.trace.writeCalls ?? "?"} pre_write_discovery=${run.trace.preWriteDiscoveryCalls ?? "?"} regenerations=${run.trace.regenerationCount ?? "?"} regen_limit_hit=${run.trace.regenerationLimitHit ?? "?"} guard_blocked=${run.trace.guardBlockedCount ?? "?"} guard_flags=${run.trace.guardFlagSetCount ?? "?"} has_error=${run.trace.hasError ?? "?"}`,
    );
  }
  console.log(`analysis: ${run.analysis.reasons.join("; ")}`);
  if (run.stdout.trim().length > 0) console.log(run.stdout.trimEnd());
  if (run.stderr.trim().length > 0) console.error(run.stderr.trimEnd());
}

async function cleanup(runs: BehaviorRun[]): Promise<void> {
  await runTimedCommand(
    ["bun", "run", CLI_ENTRY, "stop"],
    { ...process.env, NO_COLOR: "1" } as Record<string, string>,
    10_000,
    REPO_DIR,
  );
  for (const run of runs) await rm(run.workspace, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runs: BehaviorRun[] = [];

  try {
    for (const scenarioId of args.scenarioIds) {
      const scenario = BEHAVIOR_SCENARIO_BY_ID[scenarioId];
      if (!args.json) console.log(`starting ${scenario.id}: ${scenario.description}`);
      runs.push(await runScenario(scenarioId, args.model, args.timeoutMs));
    }
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
