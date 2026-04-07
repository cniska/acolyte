import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DISTILLER_PROMPT, splitScopedObservation } from "../src/memory-distiller";
import { cosineSimilarity, embedText } from "../src/memory-embedding";

export type MemoryBenchDatasetId = "longmemeval" | "locomo" | "locomo-observations" | "locomo-distilled";

export type NormalizedObservation = {
  readonly id: string;
  readonly content: string;
  readonly timestamp: string;
  readonly topic?: string | null;
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

function locomoSessionDate(conv: Record<string, unknown>, sessionNum: string): string {
  const value = conv[`session_${sessionNum}_date_time`];
  return typeof value === "string" ? value : "unknown";
}

function locomoQueries(
  qa: z.infer<typeof locomoQaSchema>[],
  convIdx: number,
  resolveDiaId: (diaId: string) => string[],
): NormalizedQuery[] {
  return qa
    .filter((q) => q.evidence.length > 0)
    .map((q, qIdx) => ({
      id: `conv${convIdx}_q${qIdx}`,
      question: q.question,
      relevantObservationIds: q.evidence.flatMap(resolveDiaId),
    }))
    .filter((q) => q.relevantObservationIds.length > 0);
}

function normalizeLoCoMo(raw: unknown[]): DatasetScenario[] {
  return raw.map((entry, convIdx) => {
    const parsed = z.object({ conversation: z.record(z.string(), z.any()), qa: z.array(locomoQaSchema) }).parse(entry);
    const conv = parsed.conversation as Record<string, unknown>;
    const observations: NormalizedObservation[] = [];
    const turnById = new Map<string, string>();

    const sessionKeys = Object.keys(conv)
      .filter((k) => /^session_\d+$/.test(k))
      .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));

    for (const sessionKey of sessionKeys) {
      const sessionNum = sessionKey.split("_")[1];
      const date = locomoSessionDate(conv, sessionNum);
      const turns = z.array(locomoTurnSchema).parse(conv[sessionKey]);

      for (const turn of turns) {
        const obsId = `conv${convIdx}_${turn.dia_id}`;
        observations.push({ id: obsId, content: `[${turn.speaker}] ${turn.text}`, timestamp: date });
        turnById.set(turn.dia_id, obsId);
      }
    }

    const queries = locomoQueries(parsed.qa, convIdx, (diaId) => {
      const id = turnById.get(diaId);
      return id ? [id] : [];
    });

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

function deriveSessionTopic(summary: string, excludeNames?: ReadonlySet<string>): string | null {
  const stopwords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "is",
    "it",
    "as",
    "be",
    "was",
    "are",
    "been",
    "has",
    "have",
    "had",
    "do",
    "does",
    "did",
    "not",
    "no",
    "so",
    "if",
    "my",
    "me",
    "we",
    "he",
    "she",
    "they",
    "this",
    "that",
    "what",
    "which",
    "who",
    "how",
    "when",
    "where",
    "i",
    "you",
    "your",
    "its",
    "about",
    "also",
    "her",
    "his",
    "their",
    "them",
    "she",
    "him",
    "would",
    "could",
    "should",
    "will",
    "can",
    "may",
    "more",
    "some",
    "been",
    "being",
    "were",
    "than",
    "very",
    "much",
    "both",
    "each",
    "other",
    "into",
    "over",
    "such",
    "then",
    "out",
    "up",
    "new",
    "one",
    "two",
    "mentioned",
    "conversation",
    "discussed",
    "talked",
    "told",
  ]);
  const freq = new Map<string, number>();
  for (const raw of summary.toLowerCase().split(/[\s\p{P}]+/u)) {
    if (raw.length > 2 && !stopwords.has(raw) && !excludeNames?.has(raw)) freq.set(raw, (freq.get(raw) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [word, count] of freq) {
    if (count > bestCount) {
      bestCount = count;
      best = word;
    }
  }
  return best;
}

function normalizeLoCoMoObservations(raw: unknown[]): DatasetScenario[] {
  return raw.map((entry, convIdx) => {
    const parsed = z
      .object({
        conversation: z.record(z.string(), z.any()),
        observation: z.record(z.string(), z.any()),
        session_summary: z.record(z.string(), z.any()).optional(),
        qa: z.array(locomoQaSchema),
      })
      .parse(entry);
    const conv = parsed.conversation as Record<string, unknown>;
    const obsData = parsed.observation as Record<string, Record<string, [string, string][]>>;
    const summaries = (parsed.session_summary ?? {}) as Record<string, string>;
    const speakerA = typeof conv.speaker_a === "string" ? conv.speaker_a.toLowerCase() : "";
    const speakerB = typeof conv.speaker_b === "string" ? conv.speaker_b.toLowerCase() : "";
    const speakerNames = new Set([speakerA, speakerB].filter((s) => s.length > 0));
    const observations: NormalizedObservation[] = [];
    const diaIdToObsIds = new Map<string, string[]>();

    const sessionKeys = Object.keys(obsData)
      .filter((k) => /^session_\d+_observation$/.test(k))
      .sort((a, b) => {
        const na = Number(a.match(/\d+/)?.[0]);
        const nb = Number(b.match(/\d+/)?.[0]);
        return na - nb;
      });

    let obsIndex = 0;
    for (const sessionKey of sessionKeys) {
      const sessionNum = sessionKey.match(/\d+/)?.[0] ?? "1";
      const date = locomoSessionDate(conv, sessionNum);
      const summaryKey = `session_${sessionNum}_summary`;
      const topic =
        typeof summaries[summaryKey] === "string" ? deriveSessionTopic(summaries[summaryKey], speakerNames) : null;
      const speakers = obsData[sessionKey];

      for (const [speaker, facts] of Object.entries(speakers)) {
        for (const [fact, diaId] of facts) {
          const obsId = `conv${convIdx}_obs${obsIndex}`;
          observations.push({ id: obsId, content: `[${speaker}] ${fact}`, timestamp: date, topic });
          const existing = diaIdToObsIds.get(diaId) ?? [];
          existing.push(obsId);
          diaIdToObsIds.set(diaId, existing);
          obsIndex++;
        }
      }
    }

    const queries = locomoQueries(parsed.qa, convIdx, (diaId) => diaIdToObsIds.get(diaId) ?? []);

    return { scenarioId: `conv${convIdx}`, observations, queries };
  });
}

const locomoObservationsAdapter: DatasetAdapter = {
  id: "locomo-observations",
  name: "LoCoMo (observations)",
  description: "10 long conversations using pre-extracted observations instead of raw turns",
  async load(dataDir = DATA_DIR) {
    const dir = join(dataDir, "locomo");
    await ensureDir(dir);
    const filePath = join(dir, LOCOMO_FILE);
    await downloadIfMissing(LOCOMO_URL, filePath);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    const parsed = z.array(z.unknown()).parse(raw);
    return {
      id: "locomo-observations" as const,
      name: "LoCoMo (observations)",
      scenarios: normalizeLoCoMoObservations(parsed),
    };
  },
};

type CachedDistillResult = {
  sessions: { sessionNum: string; facts: { content: string; topic: string | null; scope: string }[] }[];
};

async function distillSession(
  sessionTurns: { speaker: string; text: string }[],
  runner: (systemPrompt: string, userContent: string) => Promise<string>,
): Promise<{ content: string; topic: string | null; scope: string }[]> {
  const conversationText = sessionTurns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  const output = await runner(DISTILLER_PROMPT, conversationText);
  if (!output.trim()) return [];
  const parsed = splitScopedObservation(output);
  return parsed.facts.map((f) => ({ content: f.content, topic: f.topic, scope: f.scope }));
}

async function distillLoCoMoConversation(
  conv: Record<string, unknown>,
  runner: (systemPrompt: string, userContent: string) => Promise<string>,
  cachePath: string,
): Promise<CachedDistillResult> {
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8"));
  }

  const sessionKeys = Object.keys(conv)
    .filter((k) => /^session_\d+$/.test(k))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));

  const sessions: CachedDistillResult["sessions"] = [];
  for (const sessionKey of sessionKeys) {
    const sessionNum = sessionKey.split("_")[1];
    const turns = z.array(locomoTurnSchema).parse(conv[sessionKey]);
    const facts = await distillSession(
      turns.map((t) => ({ speaker: t.speaker, text: t.text })),
      runner,
    );
    sessions.push({ sessionNum, facts });
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const result: CachedDistillResult = { sessions };
  await writeFile(cachePath, JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function matchEvidenceToFacts(turnText: string, facts: { obsId: string; content: string }[]): Promise<string[]> {
  if (facts.length === 0) return [];
  const turnVec = await embedText(turnText);
  if (!turnVec) return [facts[0].obsId];
  const scored: { obsId: string; score: number }[] = [];
  for (const fact of facts) {
    const factVec = await embedText(fact.content);
    if (factVec) scored.push({ obsId: fact.obsId, score: cosineSimilarity(turnVec, factVec) });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored.filter((s) => s.score > 0.5).slice(0, 3);
  return best.length > 0 ? best.map((s) => s.obsId) : scored.length > 0 ? [scored[0].obsId] : [];
}

async function normalizeLoCoMoDistilled(
  distilled: CachedDistillResult,
  conv: Record<string, unknown>,
  qa: z.infer<typeof locomoQaSchema>[],
  convIdx: number,
): Promise<DatasetScenario> {
  const observations: NormalizedObservation[] = [];
  const sessionFacts = new Map<string, { obsId: string; content: string }[]>();

  let obsIndex = 0;
  for (const session of distilled.sessions) {
    const date = locomoSessionDate(conv, session.sessionNum);
    const facts: { obsId: string; content: string }[] = [];
    for (const fact of session.facts) {
      const obsId = `conv${convIdx}_dist${obsIndex}`;
      observations.push({ id: obsId, content: fact.content, timestamp: date, topic: fact.topic });
      facts.push({ obsId, content: fact.content });
      obsIndex++;
    }
    sessionFacts.set(session.sessionNum, facts);
  }

  const turnTextByDiaId = new Map<string, string>();
  const sessionKeys = Object.keys(conv).filter((k) => /^session_\d+$/.test(k));
  for (const sessionKey of sessionKeys) {
    const turns = z.array(locomoTurnSchema).parse(conv[sessionKey]);
    for (const turn of turns) turnTextByDiaId.set(turn.dia_id, turn.text);
  }

  const evidenceCache = new Map<string, string[]>();
  for (const q of qa) {
    for (const diaId of q.evidence) {
      if (evidenceCache.has(diaId)) continue;
      const sessionNum = diaId.split(":")[0]?.replace("D", "");
      if (!sessionNum) {
        evidenceCache.set(diaId, []);
        continue;
      }
      const facts = sessionFacts.get(sessionNum);
      if (!facts || facts.length === 0) {
        evidenceCache.set(diaId, []);
        continue;
      }
      const turnText = turnTextByDiaId.get(diaId) ?? "";
      if (!turnText) {
        evidenceCache.set(diaId, [facts[0].obsId]);
        continue;
      }
      evidenceCache.set(diaId, await matchEvidenceToFacts(turnText, facts));
    }
  }

  const queries: NormalizedQuery[] = qa
    .filter((q) => q.evidence.length > 0)
    .map((q, qIdx) => ({
      id: `conv${convIdx}_q${qIdx}`,
      question: q.question,
      relevantObservationIds: [...new Set(q.evidence.flatMap((e) => evidenceCache.get(e) ?? []))],
    }))
    .filter((q) => q.relevantObservationIds.length > 0);

  return { scenarioId: `conv${convIdx}`, observations, queries };
}

const locomoDistilledAdapter: DatasetAdapter = {
  id: "locomo-distilled",
  name: "LoCoMo (distilled)",
  description: "10 long conversations distilled through the real Acolyte distiller pipeline",
  async load(dataDir = DATA_DIR) {
    const dir = join(dataDir, "locomo");
    await ensureDir(dir);
    const filePath = join(dir, LOCOMO_FILE);
    await downloadIfMissing(LOCOMO_URL, filePath);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown[];

    const { createModel } = await import("../src/model-factory");
    const { normalizeModel, providerFromModel } = await import("../src/provider-config");
    const { sharedRateLimiter } = await import("../src/rate-limiter");
    const { appConfig } = await import("../src/app-config");

    const runner = async (systemPrompt: string, userContent: string): Promise<string> => {
      const qualifiedModel = normalizeModel(appConfig.distillModel);
      const model = createModel(qualifiedModel, sharedRateLimiter(providerFromModel(qualifiedModel)));
      const result = await model.doGenerate({
        prompt: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [{ type: "text", text: userContent }] },
        ],
        temperature: 0,
      });
      return result.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
    };

    const cacheDir = join(dir, "distilled");
    await ensureDir(cacheDir);
    const scenarios: DatasetScenario[] = [];

    for (let convIdx = 0; convIdx < raw.length; convIdx++) {
      const entry = z
        .object({ conversation: z.record(z.string(), z.any()), qa: z.array(locomoQaSchema) })
        .parse(raw[convIdx]);
      const conv = entry.conversation as Record<string, unknown>;
      const cachePath = join(cacheDir, `conv${convIdx}.json`);
      const distilled = await distillLoCoMoConversation(conv, runner, cachePath);
      scenarios.push(await normalizeLoCoMoDistilled(distilled, conv, entry.qa, convIdx));
    }

    return { id: "locomo-distilled" as const, name: "LoCoMo (distilled)", scenarios };
  },
};

export const MEMORY_BENCH_ADAPTERS: Record<MemoryBenchDatasetId, DatasetAdapter> = {
  longmemeval: longMemEvalAdapter,
  locomo: locomoAdapter,
  "locomo-observations": locomoObservationsAdapter,
  "locomo-distilled": locomoDistilledAdapter,
};

export const MEMORY_BENCH_DATASET_IDS: MemoryBenchDatasetId[] = [
  "longmemeval",
  "locomo",
  "locomo-observations",
  "locomo-distilled",
];

export function parseDatasetId(value: string): MemoryBenchDatasetId {
  if (value === "longmemeval" || value === "locomo" || value === "locomo-observations" || value === "locomo-distilled")
    return value;
  throw new Error(`Unknown dataset: ${value}. Valid: ${MEMORY_BENCH_DATASET_IDS.join(", ")}`);
}
