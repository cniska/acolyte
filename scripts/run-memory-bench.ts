import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord } from "../src/memory-contract";
import { embeddingToBuffer, embedText } from "../src/memory-embedding";
import { createSqliteMemoryStore } from "../src/memory-store";
import { searchMemories } from "../src/memory-toolkit";
import { type AggregateMetrics, aggregateMetrics, computeQueryMetrics, type QueryResult } from "./memory-bench-metrics";
import {
  type DatasetScenario,
  defaultDataDir,
  MEMORY_BENCH_ADAPTERS,
  type MemoryBenchDatasetId,
  type NormalizedDataset,
  type NormalizedObservation,
  parseDatasetId,
} from "./memory-bench-scenarios";
import { toPrettyJson } from "./perf-test-utils";

type MemoryBenchArgs = {
  datasets: MemoryBenchDatasetId[];
  kValues: number[];
  limit: number | null;
  json: boolean;
};

type ScenarioResult = {
  scenarioId: string;
  observationCount: number;
  queryCount: number;
  embeddingDurationMs: number;
  retrievalDurationMs: number;
  queries: QueryResult[];
};

type DatasetResult = {
  datasetId: MemoryBenchDatasetId;
  datasetName: string;
  scenarioCount: number;
  observationCount: number;
  queryCount: number;
  embeddingDurationMs: number;
  retrievalDurationMs: number;
  kValues: number[];
  aggregate: AggregateMetrics;
  scenarios: ScenarioResult[];
};

type BenchSummary = {
  config: {
    datasets: MemoryBenchDatasetId[];
    kValues: number[];
    limit: number | null;
    embeddingModel: string;
  };
  summary: {
    datasetsRun: number;
    totalScenarios: number;
    totalQueries: number;
    totalObservations: number;
    totalEmbeddingDurationMs: number;
    totalRetrievalDurationMs: number;
  };
  results: Record<string, DatasetResult>;
};

const DEFAULT_K_VALUES = [3, 5, 10];

function parseInteger(token: string | undefined, flag: string): number {
  if (!token) throw new Error(`Missing value for ${flag}`);
  const value = Number(token);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid value for ${flag}: ${token}`);
  return value;
}

export function parseArgs(args: string[]): MemoryBenchArgs {
  const datasets: MemoryBenchDatasetId[] = [];
  const kValues: number[] = [];
  let limit: number | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--dataset") {
      datasets.push(parseDatasetId(args[i + 1] ?? ""));
      i += 1;
      continue;
    }
    if (token === "--k") {
      kValues.push(parseInteger(args[i + 1], "--k"));
      i += 1;
      continue;
    }
    if (token === "--limit") {
      limit = parseInteger(args[i + 1], "--limit");
      i += 1;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    datasets: datasets.length > 0 ? datasets : (Object.keys(MEMORY_BENCH_ADAPTERS) as MemoryBenchDatasetId[]),
    kValues: kValues.length > 0 ? kValues : DEFAULT_K_VALUES,
    limit,
    json,
  };
}

function printUsage(): void {
  console.log("Usage: bun run scripts/run-memory-bench.ts [--dataset <id>] [--k <n>] [--limit <n>] [--json]");
}

function safeIsoDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "2024-01-01T00:00:00.000Z" : d.toISOString();
}

function toMemoryRecord(obs: NormalizedObservation, index: number): MemoryRecord {
  return {
    id: `mem_bench_${index}`,
    scopeKey: "proj_bench",
    kind: "stored",
    content: obs.content,
    createdAt: safeIsoDate(obs.timestamp),
    tokenEstimate: Math.ceil(obs.content.length / 4),
  };
}

async function runScenario(scenario: DatasetScenario, kValues: number[], tempDir: string): Promise<ScenarioResult> {
  const dbPath = join(tempDir, `${scenario.scenarioId.replace(/[^a-zA-Z0-9_-]/g, "_")}.db`);
  const store = createSqliteMemoryStore(dbPath);

  // Map observation IDs to record IDs for ground-truth matching
  const obsIdToRecordId = new Map<string, string>();

  try {
    // 1. Populate store with observations
    for (let i = 0; i < scenario.observations.length; i++) {
      const obs = scenario.observations[i];
      const record = toMemoryRecord(obs, i);
      obsIdToRecordId.set(obs.id, record.id);
      await store.write(record);
    }

    // 2. Embed all observations
    const embedStart = performance.now();
    for (let i = 0; i < scenario.observations.length; i++) {
      const obs = scenario.observations[i];
      const recordId = obsIdToRecordId.get(obs.id);
      if (!recordId) continue;
      const embedding = await embedText(obs.content);
      if (!embedding) {
        if (i === 0) throw new Error("Embedding provider returned null — check your embedding model configuration");
        continue;
      }
      store.writeEmbedding(recordId, "proj_bench", embeddingToBuffer(embedding));
    }
    const embeddingDurationMs = performance.now() - embedStart;

    // 3. Run queries and compute metrics
    const maxK = Math.max(...kValues);
    const retrievalStart = performance.now();
    const queryResults: QueryResult[] = [];

    for (const query of scenario.queries) {
      const results = await searchMemories(query.question, { store, limit: maxK });
      const retrievedRecordIds = results.map((r) => r.id);

      // Map ground-truth observation IDs to record IDs
      const relevantRecordIds = query.relevantObservationIds
        .map((obsId) => obsIdToRecordId.get(obsId))
        .filter((id): id is string => id !== undefined);

      const metrics = computeQueryMetrics(retrievedRecordIds, relevantRecordIds, kValues);

      queryResults.push({
        queryId: query.id,
        question: query.question,
        retrievedIds: retrievedRecordIds,
        relevantIds: relevantRecordIds,
        recallAtK: metrics.recallAtK,
        ndcgAtK: metrics.ndcgAtK,
      });
    }
    const retrievalDurationMs = performance.now() - retrievalStart;

    return {
      scenarioId: scenario.scenarioId,
      observationCount: scenario.observations.length,
      queryCount: scenario.queries.length,
      embeddingDurationMs,
      retrievalDurationMs,
      queries: queryResults,
    };
  } finally {
    store.close();
  }
}

async function runDataset(
  dataset: NormalizedDataset,
  kValues: number[],
  limit: number | null,
  json: boolean,
): Promise<DatasetResult> {
  const scenarios = limit !== null ? dataset.scenarios.slice(0, limit) : dataset.scenarios;
  const tempDir = await mkdtemp(join(tmpdir(), `acolyte-memory-bench-${dataset.id}-`));

  try {
    const scenarioResults: ScenarioResult[] = [];

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      if (!json) {
        process.stdout.write(`\r  ${dataset.name} scenario ${i + 1}/${scenarios.length}: ${scenario.scenarioId}`);
      }
      scenarioResults.push(await runScenario(scenario, kValues, tempDir));
    }
    if (!json && scenarios.length > 0) process.stdout.write("\n");

    const allQueries = scenarioResults.flatMap((s) => s.queries);
    const aggregate = aggregateMetrics(allQueries, kValues);

    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      scenarioCount: scenarios.length,
      observationCount: scenarioResults.reduce((sum, s) => sum + s.observationCount, 0),
      queryCount: allQueries.length,
      embeddingDurationMs: scenarioResults.reduce((sum, s) => sum + s.embeddingDurationMs, 0),
      retrievalDurationMs: scenarioResults.reduce((sum, s) => sum + s.retrievalDurationMs, 0),
      kValues,
      aggregate,
      scenarios: scenarioResults,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = defaultDataDir();
  const results: Record<string, DatasetResult> = {};

  for (const datasetId of args.datasets) {
    const adapter = MEMORY_BENCH_ADAPTERS[datasetId];
    if (!args.json) console.log(`loading ${adapter.name}...`);
    const dataset = await adapter.load(dataDir);
    if (!args.json) console.log(`  ${dataset.scenarios.length} scenarios loaded`);

    results[datasetId] = await runDataset(dataset, args.kValues, args.limit, args.json);

    if (!args.json) {
      const r = results[datasetId];
      console.log(`  ${r.queryCount} queries, ${r.observationCount} observations`);
      for (const k of args.kValues) {
        console.log(
          `  R@${k}: ${(r.aggregate.recallAtK[k] ?? 0).toFixed(3)}  NDCG@${k}: ${(r.aggregate.ndcgAtK[k] ?? 0).toFixed(3)}`,
        );
      }
    }
  }

  const allResults = Object.values(results);
  const output: BenchSummary = {
    config: {
      datasets: args.datasets,
      kValues: args.kValues,
      limit: args.limit,
      embeddingModel: "text-embedding-3-small",
    },
    summary: {
      datasetsRun: allResults.length,
      totalScenarios: allResults.reduce((sum, r) => sum + r.scenarioCount, 0),
      totalQueries: allResults.reduce((sum, r) => sum + r.queryCount, 0),
      totalObservations: allResults.reduce((sum, r) => sum + r.observationCount, 0),
      totalEmbeddingDurationMs: allResults.reduce((sum, r) => sum + r.embeddingDurationMs, 0),
      totalRetrievalDurationMs: allResults.reduce((sum, r) => sum + r.retrievalDurationMs, 0),
    },
    results,
  };

  if (args.json) {
    console.log(toPrettyJson(output));
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
