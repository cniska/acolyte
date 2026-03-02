import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type StreamEvent } from "../src/client";
import { withFakeProviderServer } from "./fake-provider-server";
import { average, median, percentile, runTimedCommand, toPrettyJson } from "./perf-test-utils";

type BenchmarkArgs = {
  runs: number;
  warmup: boolean;
  json: boolean;
  scenarioFilter: Set<string>;
};

type Scenario = {
  id: string;
  description: string;
  prompt: string;
};

type ScenarioRun = {
  scenarioId: string;
  run: number;
  durationMs: number;
  exitCode: number;
  modelCalls: number | null;
  error: string | null;
};

type ScenarioSummary = {
  scenarioId: string;
  description: string;
  samples: number;
  successRate: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
  avgModelCalls: number;
};

const DEFAULT_RUNS = 3;
const BENCH_SERVER_START_TIMEOUT_MS = 30_000;
const BENCH_SERVER_STOP_TIMEOUT_MS = 5_000;
const BENCH_SERVER_STDOUT_LINES = 120;
const REPO_DIR = join(import.meta.dir, "..");
const SERVER_ENTRY = join(REPO_DIR, "src", "server.ts");
const WAIT_SERVER_ENTRY = join(REPO_DIR, "src", "wait-server.ts");
const BENCH_MODEL = "gpt-5-mini";

const SCENARIOS: Scenario[] = [
  {
    id: "quick-answer",
    description: "No-tool baseline (model-only response).",
    prompt: '[bench:quick-answer] Reply with exactly "ok".',
  },
  {
    id: "read-summarize",
    description: "Typical read flow on one file.",
    prompt: "[bench:read-summarize] Read package.json and summarize scripts in two short bullets.",
  },
  {
    id: "redundancy-guard-probe",
    description: "Guard-sensitive probe with repeated read intents.",
    prompt:
      "[bench:redundancy-guard-probe] Read src/lifecycle.ts. Then read src/lifecycle.ts again. Then read src/lifecycle.ts once more. Finally answer with one short sentence.",
  },
];

function parseInteger(token: string | undefined, flag: string): number {
  if (!token) throw new Error(`Missing value for ${flag}`);
  const value = Number(token);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid value for ${flag}: ${token}`);
  return value;
}

function toTomlRecord(input: Record<string, string | number | boolean>): string {
  return Object.entries(input)
    .map(([key, value]) => {
      if (typeof value === "number" || typeof value === "boolean") return `${key} = ${value}`;
      return `${key} = ${JSON.stringify(value)}`;
    })
    .join("\n");
}

function reserveFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function summarizeRunError(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  return null;
}

export function parseArgs(args: string[]): BenchmarkArgs {
  let runs = DEFAULT_RUNS;
  let warmup = true;
  let json = false;
  const scenarioFilter = new Set<string>();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--runs") {
      runs = parseInteger(args[i + 1], "--runs");
      i += 1;
      continue;
    }
    if (token === "--warmup") {
      warmup = true;
      continue;
    }
    if (token === "--no-warmup") {
      warmup = false;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--scenario") {
      const id = args[i + 1]?.trim();
      if (!id) throw new Error("Missing value for --scenario");
      scenarioFilter.add(id);
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { runs, warmup, json, scenarioFilter };
}

function printUsage(): void {
  console.log("Usage: bun run scripts/run-bench.ts [--runs N] [--warmup|--no-warmup] [--scenario id] [--json]");
}

function selectedScenarios(filter: Set<string>): Scenario[] {
  if (filter.size === 0) return SCENARIOS;
  const selected = SCENARIOS.filter((scenario) => filter.has(scenario.id));
  if (selected.length === 0) throw new Error(`No scenarios matched --scenario filter (${[...filter].join(", ")})`);
  return selected;
}

async function writeBenchConfig(homeDir: string, port: number, providerBaseUrl: string): Promise<void> {
  const configDir = join(homeDir, ".acolyte");
  await mkdir(configDir, { recursive: true });
  const config = {
    port,
    apiUrl: `http://localhost:${port}`,
    model: BENCH_MODEL,
    openaiBaseUrl: providerBaseUrl,
    transportMode: "http",
    permissionMode: "write",
  };
  await writeFile(join(configDir, "config.toml"), `${toTomlRecord(config)}\n`, "utf8");
}

async function prepareBenchWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "acolyte-run-bench-workspace-"));
  await mkdir(join(workspaceDir, "src"), { recursive: true });
  await writeFile(
    join(workspaceDir, "package.json"),
    JSON.stringify({ name: "bench-workspace", scripts: { test: "bun test", verify: "bun run verify" } }, null, 2),
    "utf8",
  );
  await writeFile(
    join(workspaceDir, "src", "lifecycle.ts"),
    ["export function stepOne() {", "  return 'ok';", "}", ""].join("\n"),
    "utf8",
  );
  return workspaceDir;
}

async function startBenchServer(
  homeDir: string,
  workspaceDir: string,
  port: number,
  providerBaseUrl: string,
): Promise<{ stop: () => Promise<void> }> {
  const env = {
    ...process.env,
    HOME: homeDir,
    NO_COLOR: "1",
    OPENAI_BASE_URL: providerBaseUrl,
    OPENAI_API_KEY: "test-key",
  } as Record<string, string>;

  const proc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    cwd: workspaceDir,
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const waitResult = await runTimedCommand(
    ["bun", "run", WAIT_SERVER_ENTRY, "--url", `http://localhost:${port}/v1/status`, "--timeout-ms", "30000"],
    env,
    BENCH_SERVER_START_TIMEOUT_MS,
    workspaceDir,
  );

  if (waitResult.exitCode !== 0) {
    proc.kill();
    const [stdout, stderr] = await Promise.all([stdoutPromise.catch(() => ""), stderrPromise.catch(() => "")]);
    throw new Error(
      `Failed to start bench server on port ${port}\n${stdout.split("\n").slice(-BENCH_SERVER_STDOUT_LINES).join("\n")}\n${stderr}`,
    );
  }

  return {
    stop: async () => {
      proc.kill();
      await Promise.race([proc.exited, Bun.sleep(BENCH_SERVER_STOP_TIMEOUT_MS)]);
    },
  };
}

async function runScenario(apiUrl: string, workspaceDir: string, scenario: Scenario, run: number): Promise<ScenarioRun> {
  const startedAt = performance.now();
  const client = createClient({ apiUrl, transportMode: "http" });

  try {
    const reply = await client.replyStream(
      {
        message: scenario.prompt,
        history: [],
        model: BENCH_MODEL,
        sessionId: `bench_${scenario.id}_${run}`,
        workspace: workspaceDir,
      },
      { onEvent: (_event: StreamEvent) => {} },
    );

    return {
      scenarioId: scenario.id,
      run,
      durationMs: performance.now() - startedAt,
      exitCode: 0,
      modelCalls: typeof reply.modelCalls === "number" ? reply.modelCalls : null,
      error: null,
    };
  } catch (error) {
    return {
      scenarioId: scenario.id,
      run,
      durationMs: performance.now() - startedAt,
      exitCode: 1,
      modelCalls: null,
      error: summarizeRunError(error),
    };
  }
}

export function summarizeScenarioRuns(scenario: Scenario, runs: ScenarioRun[]): ScenarioSummary {
  const durations = runs.map((run) => run.durationMs);
  const modelCalls = runs.map((run) => run.modelCalls ?? 0);
  const successes = runs.filter((run) => run.exitCode === 0).length;
  return {
    scenarioId: scenario.id,
    description: scenario.description,
    samples: runs.length,
    successRate: runs.length === 0 ? 0 : (successes / runs.length) * 100,
    minMs: durations.length === 0 ? 0 : Math.min(...durations),
    medianMs: median(durations),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length === 0 ? 0 : Math.max(...durations),
    avgMs: average(durations),
    avgModelCalls: average(modelCalls),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = selectedScenarios(args.scenarioFilter);

  await withFakeProviderServer(async (providerBaseUrl) => {
    const homeDir = await mkdtemp(join(tmpdir(), "acolyte-run-bench-home-"));
    const workspaceDir = await prepareBenchWorkspace();
    const port = reserveFreePort();
    const apiUrl = `http://localhost:${port}`;

    await writeBenchConfig(homeDir, port, providerBaseUrl);
    const server = await startBenchServer(homeDir, workspaceDir, port, providerBaseUrl);

    try {
      const warmupScenario = SCENARIOS.find((scenario) => scenario.id === "quick-answer");
      if (args.warmup && warmupScenario) {
        await runScenario(apiUrl, workspaceDir, warmupScenario, 0);
      }

      const allRuns: ScenarioRun[] = [];
      for (const scenario of scenarios) {
        for (let i = 0; i < args.runs; i += 1) {
          allRuns.push(await runScenario(apiUrl, workspaceDir, scenario, i + 1));
        }
      }

      const summaries = scenarios.map((scenario) =>
        summarizeScenarioRuns(
          scenario,
          allRuns.filter((run) => run.scenarioId === scenario.id),
        ),
      );

      if (args.json) {
        console.log(
          toPrettyJson({
            config: {
              runs: args.runs,
              warmup: args.warmup,
              json: args.json,
              scenarioFilter: [...args.scenarioFilter],
            },
            summaries,
            runs: allRuns,
          }),
        );
        return;
      }

      console.log("Acolyte run benchmark");
      console.log(`runs=${args.runs} warmup=${args.warmup} backend=fake-provider mode=e2e`);
      for (const summary of summaries) {
        console.log("");
        console.log(`${summary.scenarioId} - ${summary.description}`);
        console.log(
          `  samples=${summary.samples} success=${summary.successRate.toFixed(0)}% median=${summary.medianMs.toFixed(0)}ms p95=${summary.p95Ms.toFixed(0)}ms avgModelCalls=${summary.avgModelCalls.toFixed(1)}`,
        );
        const failed = allRuns.find((run) => run.scenarioId === summary.scenarioId && run.exitCode !== 0);
        if (failed?.error) console.log(`  error=${failed.error}`);
      }
      console.log("");
      console.log("Note: deterministic fake provider keeps runs repeatable and comparable.");
    } finally {
      await server.stop();
      await rm(homeDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
