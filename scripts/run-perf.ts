import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "../src/client-contract";
import { createClient } from "../src/client-factory";
import { withFakeProviderServer } from "./fake-provider-server";
import { PERF_SCENARIO_LIST, type Scenario, type ScenarioId } from "./perf-scenarios";
import { average, median, percentile, runTimedCommand, toPrettyJson } from "./perf-test-utils";
import { createPerfProviderHandler } from "./perf-utils";

type PerfArgs = {
  runs: number;
  warmup: boolean;
  failMedianMs: number | null;
};

type ScenarioRun = {
  scenarioId: ScenarioId;
  run: number;
  durationMs: number;
  exitCode: number;
  modelCalls: number | null;
  error: string | null;
};

type ScenarioSummary = {
  scenarioId: ScenarioId;
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

type PerfSummary = {
  scenarioCount: number;
  totalRuns: number;
  failedRuns: number;
};

const DEFAULT_RUNS = 3;
const PERF_SERVER_START_TIMEOUT_MS = 30_000;
const PERF_SERVER_STOP_TIMEOUT_MS = 5_000;
const PERF_SERVER_STDOUT_LINES = 120;
const REPO_DIR = join(import.meta.dir, "..");
const SERVER_ENTRY = join(REPO_DIR, "src", "server.ts");
const WAIT_SERVER_ENTRY = join(REPO_DIR, "src", "wait-server.ts");
const PERF_MODEL = "gpt-5-mini";
const SCENARIOS: Scenario[] = PERF_SCENARIO_LIST;

export function buildPerfSessionId(scenarioId: ScenarioId, run: number): string {
  return `sess_perf_${scenarioId}_${run}`;
}

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

export function parseArgs(args: string[]): PerfArgs {
  let runs = DEFAULT_RUNS;
  let warmup = true;
  let failMedianMs: number | null = null;

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
    if (token === "--fail-median-ms") {
      failMedianMs = parseInteger(args[i + 1], "--fail-median-ms");
      i += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { runs, warmup, failMedianMs };
}

function printUsage(): void {
  console.log("Usage: bun run scripts/run-perf.ts [--runs N] [--warmup|--no-warmup] [--fail-median-ms N]");
}

async function writePerfConfig(homeDir: string, port: number, providerBaseUrl: string): Promise<void> {
  const configDir = join(homeDir, ".acolyte");
  await mkdir(configDir, { recursive: true });
  const config = {
    port,
    apiUrl: `http://localhost:${port}`,
    model: PERF_MODEL,
    openaiBaseUrl: providerBaseUrl,
    transportMode: "http",
    permissionMode: "write",
  };
  await writeFile(join(configDir, "config.toml"), `${toTomlRecord(config)}\n`, "utf8");
}

async function preparePerfWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "acolyte-run-perf-workspace-"));
  await mkdir(join(workspaceDir, "src"), { recursive: true });
  await writeFile(
    join(workspaceDir, "package.json"),
    JSON.stringify({ name: "perf-workspace", scripts: { test: "bun test", verify: "bun run verify" } }, null, 2),
    "utf8",
  );
  await writeFile(
    join(workspaceDir, "src", "lifecycle.ts"),
    ["export function stepOne() {", "  return 'ok';", "}", ""].join("\n"),
    "utf8",
  );
  return workspaceDir;
}

async function startPerfServer(
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
    PERF_SERVER_START_TIMEOUT_MS,
    workspaceDir,
  );

  if (waitResult.exitCode !== 0) {
    proc.kill();
    const [stdout, stderr] = await Promise.all([stdoutPromise.catch(() => ""), stderrPromise.catch(() => "")]);
    throw new Error(
      `Failed to start perf server on port ${port}\n${stdout.split("\n").slice(-PERF_SERVER_STDOUT_LINES).join("\n")}\n${stderr}`,
    );
  }

  return {
    stop: async () => {
      proc.kill();
      await Promise.race([proc.exited, Bun.sleep(PERF_SERVER_STOP_TIMEOUT_MS)]);
    },
  };
}

async function runScenario(
  apiUrl: string,
  workspaceDir: string,
  scenario: Scenario,
  run: number,
): Promise<ScenarioRun> {
  const startedAt = performance.now();
  const client = createClient({ apiUrl, transportMode: "http" });

  try {
    const reply = await client.replyStream(
      {
        message: scenario.prompt,
        history: [],
        model: PERF_MODEL,
        sessionId: buildPerfSessionId(scenario.id, run),
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
  const perfProviderHandler = createPerfProviderHandler();

  await withFakeProviderServer(
    async (providerBaseUrl) => {
      const homeDir = await mkdtemp(join(tmpdir(), "acolyte-run-perf-home-"));
      const workspaceDir = await preparePerfWorkspace();
      const port = reserveFreePort();
      const apiUrl = `http://localhost:${port}`;

      await writePerfConfig(homeDir, port, providerBaseUrl);
      const server = await startPerfServer(homeDir, workspaceDir, port, providerBaseUrl);

      try {
        const warmupScenario = SCENARIOS[0];
        if (args.warmup && warmupScenario) {
          await runScenario(apiUrl, workspaceDir, warmupScenario, 0);
        }

        const allRuns: ScenarioRun[] = [];
        for (const scenario of SCENARIOS) {
          for (let i = 0; i < args.runs; i += 1) {
            allRuns.push(await runScenario(apiUrl, workspaceDir, scenario, i + 1));
          }
        }

        const summaries = SCENARIOS.map((scenario) =>
          summarizeScenarioRuns(
            scenario,
            allRuns.filter((run) => run.scenarioId === scenario.id),
          ),
        );
        const failedRun = allRuns.find((run) => run.exitCode !== 0);
        if (failedRun) {
          throw new Error(
            `Perf run failed on scenario=${failedRun.scenarioId} run=${failedRun.run}: ${failedRun.error ?? "unknown error"}`,
          );
        }

        const baseline = summaries[0];
        if (baseline && args.failMedianMs !== null && baseline.medianMs > args.failMedianMs) {
          throw new Error(
            `Perf regression: median ${baseline.medianMs.toFixed(1)}ms exceeds threshold ${args.failMedianMs}ms`,
          );
        }

        const scenarios = Object.fromEntries(
          SCENARIOS.map((scenario) => {
            const scenarioRuns = allRuns.filter((run) => run.scenarioId === scenario.id);
            const summary = summaries.find((entry) => entry.scenarioId === scenario.id);
            return [
              scenario.id,
              {
                summary,
                runs: scenarioRuns,
              },
            ];
          }),
        ) as Record<ScenarioId, { summary: ScenarioSummary | undefined; runs: ScenarioRun[] }>;
        const summary: PerfSummary = {
          scenarioCount: SCENARIOS.length,
          totalRuns: allRuns.length,
          failedRuns: allRuns.filter((run) => run.exitCode !== 0).length,
        };

        console.log(
          toPrettyJson({
            config: {
              runs: args.runs,
              warmup: args.warmup,
              failMedianMs: args.failMedianMs,
            },
            summary,
            scenarios,
          }),
        );
      } finally {
        await server.stop();
        await rm(homeDir, { recursive: true, force: true });
        await rm(workspaceDir, { recursive: true, force: true });
      }
    },
    {
      handleRequest: perfProviderHandler,
    },
  );
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
