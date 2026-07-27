import type { LanguageModelV4ToolCall } from "@ai-sdk/provider";
import { appConfig } from "./app-config";
import { clampToTokenEstimate, normalizeMemoryText } from "./distill-ops";
import { log } from "./log";
import {
  defaultMemoryPolicy,
  type MemoryConsolidationMetrics,
  type MemoryMergeResult,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryStore,
  memoryMergeResultSchema,
  scopeFromKey,
} from "./memory-contract";
import { bufferToEmbedding, cosineSimilarity } from "./memory-embedding";
import { addObservation, retireMemories } from "./memory-ops";
import { memoryTaskQueue } from "./memory-scheduling";
import { getMemoryStore } from "./memory-store";
import { createModel } from "./model-factory";
import { normalizeModel, providerFromModel } from "./provider-config";
import { sharedRateLimiter } from "./rate-limiter";
import { toFunctionTool } from "./tool-contract";

const MEMORY_MERGE_TOOL = toFunctionTool({
  id: "memory-merge",
  description: "Consolidate the shown facts into sharper successors or retire noisy facts.",
  inputSchema: memoryMergeResultSchema.toJSONSchema() as Record<string, unknown>,
});

export const CONSOLIDATOR_PROMPT = `I keep a small, sharp memory corpus. These are durable facts from one scope.

I consolidate only what the record proves. I return no tool call when every fact should remain as it is.

When several shown facts express one durable claim, I write one precise successor and list every id it replaces. When a fact is stale or contradicted by the other shown facts, I write its true successor and list the stale id. A successor must preserve useful detail and stand alone. It must replace at least one shown id.

When a shown fact is noise, an obsolete transient detail, or cannot stand as a durable fact, I list its id in noise. I never name an id that is not shown. I do not retire a fact merely because this batch lacks enough context to improve it. What I supersede and retire remains archived, so I favor a conservative corpus over a large one.`;

export type MemoryMergeRunner = (systemPrompt: string, userContent: string) => Promise<MemoryMergeResult[]>;

export type MemoryConsolidator = {
  consolidate(scopeKey: string): Promise<MemoryConsolidationMetrics>;
};

export type MemoryConsolidatorDeps = {
  store: MemoryStore;
  runner: MemoryMergeRunner;
  policy: MemoryPolicy;
};

function parseToolCall(call: Pick<LanguageModelV4ToolCall, "input">): MemoryMergeResult | null {
  try {
    const parsed = memoryMergeResultSchema.safeParse(JSON.parse(call.input));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function defaultRunner(systemPrompt: string, userContent: string): Promise<MemoryMergeResult[]> {
  const qualifiedModel = normalizeModel(appConfig.distillModel);
  const model = createModel(qualifiedModel, sharedRateLimiter(providerFromModel(qualifiedModel)));
  const { stream } = await model.doStream({
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [{ type: "text", text: userContent }] },
    ],
    tools: [MEMORY_MERGE_TOOL],
    toolChoice: { type: "auto" },
  });
  const results: MemoryMergeResult[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "error") throw value.error instanceof Error ? value.error : new Error(String(value.error));
    if (value.type !== "tool-call" || value.toolName !== "memory-merge") continue;
    const result = parseToolCall(value);
    if (result) results.push(result);
  }
  return results;
}

function renderBatch(records: readonly MemoryRecord[]): string {
  return `facts:\n${records.map((record) => `${record.id}: ${normalizeMemoryText(record.content)}`).join("\n")}`;
}

function partition<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push([...items.slice(index, index + size)]);
  return batches;
}

export async function createConsolidationBatches(
  records: readonly MemoryRecord[],
  store: MemoryStore,
  policy: MemoryPolicy,
): Promise<MemoryRecord[][]> {
  const batches: MemoryRecord[][] = [];
  const tagged = new Map<string, MemoryRecord[]>();
  const untagged: MemoryRecord[] = [];
  for (const record of records) {
    if (record.topic) tagged.set(record.topic, [...(tagged.get(record.topic) ?? []), record]);
    else untagged.push(record);
  }
  for (const group of tagged.values()) batches.push(...partition(group, policy.consolidationBatchSize));
  if (untagged.length < 2) return batches;

  let embeddings = new Map<string, Buffer>();
  try {
    embeddings = await store.getEmbeddings(untagged.map((record) => record.id));
  } catch (error) {
    log.warn("memory.consolidate.embeddings_failed", { error: String(error) });
  }
  const clusters: MemoryRecord[][] = [];
  for (const record of untagged) {
    const embedding = embeddings.get(record.id);
    if (!embedding) continue;
    const cluster = clusters.find((candidate) => {
      const anchor = embeddings.get(candidate[0].id);
      if (!anchor) return false;
      try {
        return (
          cosineSimilarity(bufferToEmbedding(embedding), bufferToEmbedding(anchor)) >=
          policy.consolidationSimilarityThreshold
        );
      } catch {
        return false;
      }
    });
    if (cluster && cluster.length < policy.consolidationBatchSize) cluster.push(record);
    else clusters.push([record]);
  }
  for (const cluster of clusters) {
    if (cluster.length > 1) batches.push(cluster);
  }
  return batches;
}

function validIds(ids: readonly string[], shown: ReadonlySet<string>): string[] {
  return [...new Set(ids)].filter((id) => shown.has(id));
}

export function createMemoryConsolidator(deps: Partial<MemoryConsolidatorDeps> = {}): MemoryConsolidator {
  const policy = deps.policy ?? defaultMemoryPolicy;
  const runner = deps.runner ?? defaultRunner;
  return {
    async consolidate(scopeKey): Promise<MemoryConsolidationMetrics> {
      const scope = scopeFromKey(scopeKey);
      if (scope === "session") throw new Error("Only user and project memories can be consolidated");
      const store = deps.store ?? (await getMemoryStore());
      return memoryTaskQueue.enqueue(scopeKey, async () => {
        const records = await store.list({ scopeKey });
        const batches = await createConsolidationBatches(records, store, policy);
        const metrics: MemoryConsolidationMetrics = {
          batches: batches.length,
          createdFacts: 0,
          supersededFacts: 0,
          retiredNoiseFacts: 0,
        };
        for (const batch of batches) {
          const shown = new Set(batch.map((record) => record.id));
          const results = await runner(CONSOLIDATOR_PROMPT, renderBatch(batch));
          const successorsBySource = new Map<string, string[]>();
          const requestedNoise = new Set<string>();
          for (const result of results) {
            for (const successor of result.successors) {
              const supersedes = validIds(successor.supersedes, shown);
              if (supersedes.length === 0) continue;
              const content = clampToTokenEstimate(normalizeMemoryText(successor.content), policy.maxOutputTokens);
              if (!content) continue;
              const written = await addObservation(scopeKey, content, {
                store,
                topic: successor.topic?.trim().toLowerCase() || null,
              });
              if (!written) continue;
              metrics.createdFacts++;
              for (const source of supersedes) {
                successorsBySource.set(source, [...(successorsBySource.get(source) ?? []), written.id]);
              }
            }
            for (const id of validIds(result.noise, shown)) requestedNoise.add(id);
          }
          for (const [source, successors] of successorsBySource) {
            const retired = await retireMemories(
              [source],
              { kind: "superseded", by: [...new Set(successors)] },
              { store },
            );
            metrics.supersededFacts += retired.length;
          }
          const noise = [...requestedNoise].filter((id) => !successorsBySource.has(id));
          if (noise.length > 0) {
            const retired = await retireMemories(noise, { kind: "noise" }, { store });
            metrics.retiredNoiseFacts += retired.length;
          }
        }
        log.debug("memory.consolidate.done", { scopeKey, ...metrics });
        return metrics;
      });
    },
  };
}

const defaultConsolidator = createMemoryConsolidator();

export function consolidateMemories(scopeKey: string): Promise<MemoryConsolidationMetrics> {
  return defaultConsolidator.consolidate(scopeKey);
}
