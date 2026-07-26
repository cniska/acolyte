import { CodedError } from "./coded-error";
import { ERROR_KINDS, MEMORY_ERROR_CODES } from "./error-contract";
import {
  createMemoryPolicy,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStore,
} from "./memory-contract";
import {
  bufferToEmbedding,
  computeIdf,
  cosineSimilarity,
  embedQuery,
  embedText,
  filterByTopicEmbedding,
  matchTopicsByEmbedding,
  tokenOverlap,
} from "./memory-embedding";
import { resolveScopeKey, type ScopeContext, visibleScopeKeys } from "./memory-ops";
import { getMemoryStore } from "./memory-store";

async function embedTopics(records: readonly MemoryRecord[]): Promise<Map<string, Float32Array>> {
  const topics = new Set<string>();
  for (const r of records) {
    if (r.topic) topics.add(r.topic);
  }
  const result = new Map<string, Float32Array>();
  for (const topic of topics) {
    const vec = await embedText(topic);
    if (vec) result.set(topic, vec);
  }
  return result;
}

function allowedScopeKeys(ctx: ScopeContext, scope?: MemoryScope): Set<string> {
  if (!scope) return visibleScopeKeys(ctx);
  const key = resolveScopeKey(scope, ctx, { strict: true });
  return new Set(key ? [key] : []);
}

export async function searchMemories(
  query: string,
  ctx: ScopeContext,
  options?: {
    scope?: MemoryScope;
    limit?: number;
    store?: MemoryStore;
    policy?: MemoryPolicy;
    embed?: typeof embedText;
    // Distillation reads the corpus to supersede within it, which is not the model recalling a
    // fact; counting it would inflate the recall evidence a retirement pass is meant to weigh.
    touch?: boolean;
  },
): Promise<MemoryRecord[]> {
  const store = options?.store ?? (await getMemoryStore());
  const limit = options?.limit ?? 10;
  const policy = options?.policy ?? createMemoryPolicy();
  const touch = options?.touch ?? true;
  const touchRecalled = async (ids: string[]): Promise<void> => {
    if (touch) await store.touchRecalled(ids);
  };
  const allowed = allowedScopeKeys(ctx, options?.scope);
  if (allowed.size === 0) return [];

  const all = await store.list();
  const filtered = all.filter((r) => allowed.has(r.scopeKey));
  if (filtered.length === 0) return [];

  const queryEmbedding = options?.embed ? await options.embed(query) : await embedQuery(query);
  if (!queryEmbedding) {
    throw new CodedError(MEMORY_ERROR_CODES.embeddingUnavailable, "The embedding provider returned no query vector.", {
      kind: ERROR_KINDS.embeddingUnavailable,
    });
  }

  if (store.searchByEmbedding) {
    const oversample = (options?.scope ? limit * 2 : limit) * 2;
    const raw = await store.searchByEmbedding(queryEmbedding, { limit: oversample });
    const scoped = raw.filter((r) => allowed.has(r.scopeKey));
    const pgTopicEmbeddings = await embedTopics(scoped);
    const pgMatchedTopics = matchTopicsByEmbedding(queryEmbedding, pgTopicEmbeddings, policy.topicThreshold);
    const pgTopicFiltered = filterByTopicEmbedding(scoped, pgMatchedTopics, policy.minTopicFilterSize);
    const idf = computeIdf(pgTopicFiltered.map((r) => r.content));
    const rescored = pgTopicFiltered.map((record, rank) => {
      const positionScore = 1 - rank / pgTopicFiltered.length;
      const overlap = tokenOverlap(query, record.content, idf);
      return { record, score: positionScore * policy.cosineWeight + overlap * policy.tokenWeight };
    });
    rescored.sort((a, b) => b.score - a.score);
    const results = rescored.slice(0, limit).map((s) => s.record);
    await touchRecalled(results.map((r) => r.id));
    return results;
  }

  const topicEmbeddings = await embedTopics(filtered);
  const matchedTopics = matchTopicsByEmbedding(queryEmbedding, topicEmbeddings, policy.topicThreshold);
  const topicFiltered = filterByTopicEmbedding(filtered, matchedTopics, policy.minTopicFilterSize);
  const ids = topicFiltered.map((r) => r.id);
  const embeddings = await store.getEmbeddings(ids);
  const idf = computeIdf(topicFiltered.map((r) => r.content));

  const scored = topicFiltered.map((record) => {
    const buf = embeddings.get(record.id);
    const cosine = buf ? cosineSimilarity(queryEmbedding, bufferToEmbedding(buf)) : 0;
    const overlap = tokenOverlap(query, record.content, idf);
    const score = cosine * policy.cosineWeight + overlap * policy.tokenWeight;
    return { record, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit).map((s) => s.record);
  await touchRecalled(results.map((r) => r.id));
  return results;
}
