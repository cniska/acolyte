import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type MemoryBenchDatasetId = "longmemeval" | "locomo";

export type NormalizedObservation = {
  readonly id: string;
  readonly content: string;
  readonly timestamp: string;
};

export type NormalizedQuery = {
  readonly id: string;
  readonly question: string;
  readonly relevantObservationIds: readonly string[];
};

export type DatasetScenario = {
  readonly scenarioId: string;
  readonly observations: readonly NormalizedObservation[];
  readonly queries: readonly NormalizedQuery[];
};

export type NormalizedDataset = {
  readonly id: MemoryBenchDatasetId;
  readonly name: string;
  readonly scenarios: readonly DatasetScenario[];
};

export type DatasetAdapter = {
  readonly id: MemoryBenchDatasetId;
  readonly name: string;
  readonly description: string;
  readonly load: (dataDir: string) => Promise<NormalizedDataset>;
};

const DATA_DIR = join(import.meta.dir, "data", "memory-bench");

export function defaultDataDir(): string {
  return DATA_DIR;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function downloadIfMissing(url: string, dest: string): Promise<void> {
  try {
    await readFile(dest);
    return;
  } catch {
    // file missing — download
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  const text = await response.text();
  await writeFile(dest, text, "utf8");
}

const longMemEvalTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const longMemEvalInstanceSchema = z.object({
  question_id: z.string().min(1),
  question_type: z.string().min(1),
  question: z.string().min(1),
  answer: z.union([z.string(), z.number()]),
  question_date: z.string().optional(),
  haystack_session_ids: z.array(z.string()),
  haystack_dates: z.array(z.string()).optional(),
  haystack_sessions: z.array(z.array(longMemEvalTurnSchema)),
  answer_session_ids: z.array(z.string()),
});

const LONGMEMEVAL_URL =
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json";
const LONGMEMEVAL_FILE = "longmemeval_s_cleaned.json";

function normalizeLongMemEval(raw: z.infer<typeof longMemEvalInstanceSchema>[]): DatasetScenario[] {
  return raw.map((instance) => {
    const answerSessionSet = new Set(instance.answer_session_ids);
    const observations: NormalizedObservation[] = [];
    const relevantIds: string[] = [];

    for (let sIdx = 0; sIdx < instance.haystack_sessions.length; sIdx++) {
      const sessionId = instance.haystack_session_ids[sIdx];
      const session = instance.haystack_sessions[sIdx];
      const date = instance.haystack_dates?.[sIdx] ?? `2024-01-01T00:00:00.000Z`;
      const isAnswer = answerSessionSet.has(sessionId);

      for (let tIdx = 0; tIdx < session.length; tIdx++) {
        const turn = session[tIdx];
        const obsId = `${instance.question_id}_s${sIdx}_t${tIdx}`;
        observations.push({ id: obsId, content: `[${turn.role}] ${turn.content}`, timestamp: date });
        if (isAnswer) relevantIds.push(obsId);
      }
    }

    return {
      scenarioId: instance.question_id,
      observations,
      queries: [{ id: instance.question_id, question: instance.question, relevantObservationIds: relevantIds }],
    };
  });
}

const longMemEvalAdapter: DatasetAdapter = {
  id: "longmemeval",
  name: "LongMemEval",
  description: "500 questions testing long-term memory across multi-session conversations (~115k tokens each)",
  async load(dataDir = DATA_DIR) {
    const dir = join(dataDir, "longmemeval");
    await ensureDir(dir);
    const filePath = join(dir, LONGMEMEVAL_FILE);
    await downloadIfMissing(LONGMEMEVAL_URL, filePath);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    const parsed = z.array(longMemEvalInstanceSchema).parse(raw);
    return { id: "longmemeval" as const, name: "LongMemEval", scenarios: normalizeLongMemEval(parsed) };
  },
};

const locomoTurnSchema = z.object({
  speaker: z.string(),
  dia_id: z.string(),
  text: z.string(),
});

const locomoQaSchema = z.object({
  question: z.string(),
  answer: z.union([z.string(), z.number()]).optional(),
  evidence: z.array(z.string()),
  category: z.number(),
});

const LOCOMO_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";
const LOCOMO_FILE = "locomo10.json";

function normalizeLoCoMo(raw: unknown[]): DatasetScenario[] {
  return raw.map((entry, convIdx) => {
    const parsed = z.object({ conversation: z.record(z.string(), z.any()), qa: z.array(locomoQaSchema) }).parse(entry);
    const conv = parsed.conversation as Record<string, unknown>;
    const observations: NormalizedObservation[] = [];
    const turnById = new Map<string, string>();

    // Extract sessions from conversation object (session_1, session_2, ...)
    const sessionKeys = Object.keys(conv)
      .filter((k) => /^session_\d+$/.test(k))
      .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));

    for (const sessionKey of sessionKeys) {
      const dateKey = `${sessionKey}_date_time`;
      const date = typeof conv[dateKey] === "string" ? (conv[dateKey] as string) : "unknown";
      const turns = z.array(locomoTurnSchema).parse(conv[sessionKey]);

      for (const turn of turns) {
        const obsId = `conv${convIdx}_${turn.dia_id}`;
        observations.push({ id: obsId, content: `[${turn.speaker}] ${turn.text}`, timestamp: date });
        turnById.set(turn.dia_id, obsId);
      }
    }

    // Map QA evidence to observation IDs
    const queries: NormalizedQuery[] = parsed.qa
      .filter((qa) => qa.evidence.length > 0)
      .map((qa, qIdx) => ({
        id: `conv${convIdx}_q${qIdx}`,
        question: qa.question,
        relevantObservationIds: qa.evidence.map((e) => turnById.get(e)).filter((id): id is string => id !== undefined),
      }))
      .filter((q) => q.relevantObservationIds.length > 0);

    return { scenarioId: `conv${convIdx}`, observations, queries };
  });
}

const locomoAdapter: DatasetAdapter = {
  id: "locomo",
  name: "LoCoMo",
  description: "10 long conversations with QA pairs testing factual recall and temporal reasoning",
  async load(dataDir = DATA_DIR) {
    const dir = join(dataDir, "locomo");
    await ensureDir(dir);
    const filePath = join(dir, LOCOMO_FILE);
    await downloadIfMissing(LOCOMO_URL, filePath);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    const parsed = z.array(z.unknown()).parse(raw);
    return { id: "locomo" as const, name: "LoCoMo", scenarios: normalizeLoCoMo(parsed) };
  },
};

export const MEMORY_BENCH_ADAPTERS: Record<MemoryBenchDatasetId, DatasetAdapter> = {
  longmemeval: longMemEvalAdapter,
  locomo: locomoAdapter,
};

export const MEMORY_BENCH_DATASET_IDS: MemoryBenchDatasetId[] = ["longmemeval", "locomo"];

export function parseDatasetId(value: string): MemoryBenchDatasetId {
  if (value === "longmemeval" || value === "locomo") return value;
  throw new Error(`Unknown dataset: ${value}. Valid: ${MEMORY_BENCH_DATASET_IDS.join(", ")}`);
}
