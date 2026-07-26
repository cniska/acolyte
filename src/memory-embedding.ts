import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { appConfig } from "./app-config";
import { unreachable } from "./assert";
import { CodedError } from "./coded-error";
import { errorMessage, MEMORY_ERROR_CODES } from "./error-contract";
import { log } from "./log";
import {
  bareModelId,
  type EmbeddingProvider,
  isEmbeddingProvider,
  isEmbeddingProviderAvailable,
  normalizeModel,
  type ProviderCredentials,
  providerFromModel,
} from "./provider-config";

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

type EmbeddingTarget = {
  provider: EmbeddingProvider;
  model: string;
  apiKey: string | undefined;
  baseUrl: string | undefined;
};

function targetFor(provider: EmbeddingProvider, configuredModel: string): EmbeddingTarget | null {
  const creds: ProviderCredentials = appConfig[provider] ?? {};
  if (!isEmbeddingProviderAvailable(provider, creds)) return null;
  // The gateway routes by provider/model, so the nominal provider has to survive in the id.
  const model = provider === "vercel" ? normalizeModel(configuredModel) : configuredModel;
  return { provider, model, apiKey: creds.apiKey, baseUrl: creds.baseUrl };
}

/**
 * Embeddings follow their model id's nominal provider. The gateway is selected only by an explicit
 * `vercel/` model id, while a dedicated base URL always uses its own key and OpenAI-compatible API.
 */
export function resolveEmbeddingTarget(configuredModel: string): EmbeddingTarget | null {
  const { baseUrl, apiKey } = appConfig.embedding;
  if (baseUrl) {
    if (!apiKey) return null;
    return { provider: "openai", model: configuredModel, apiKey, baseUrl };
  }
  const nominal = providerFromModel(configuredModel);
  return isEmbeddingProvider(nominal) ? targetFor(nominal, configuredModel) : null;
}

function createEmbeddingModel(target: EmbeddingTarget) {
  const settings = { apiKey: target.apiKey, ...(target.baseUrl ? { baseURL: target.baseUrl } : {}) };
  switch (target.provider) {
    case "openai":
      return createOpenAI(settings).embeddingModel(bareModelId(target.model));
    case "google":
      return createGoogleGenerativeAI(settings).embeddingModel(bareModelId(target.model));
    case "vercel": {
      const gatewayModelId = target.model.startsWith("vercel/") ? target.model.slice("vercel/".length) : target.model;
      return createOpenAI(settings).embeddingModel(gatewayModelId);
    }
    default:
      return unreachable(target.provider);
  }
}

// appConfig's provider entries are mutated in place, so the cache compares copied values, not the live object.
let cached: (EmbeddingTarget & { embeddingModel: ReturnType<typeof createEmbeddingModel> }) | null = null;

function sameTarget(a: EmbeddingTarget, b: EmbeddingTarget): boolean {
  return a.provider === b.provider && a.model === b.model && a.apiKey === b.apiKey && a.baseUrl === b.baseUrl;
}

function getEmbeddingModel() {
  const target = resolveEmbeddingTarget(appConfig.embedding.model);
  if (!target) return null;
  if (cached && sameTarget(cached, target)) return cached.embeddingModel;
  cached = { ...target, embeddingModel: createEmbeddingModel(target) };
  return cached.embeddingModel;
}

const STOPWORDS = new Set([
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
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[\s\p{P}]+/u)) {
    if (raw.length > 1 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

export function tokenOverlap(query: string, content: string, idf?: ReadonlyMap<string, number>): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const contentTokens = tokenize(content);
  if (!idf) {
    let hits = 0;
    for (const token of queryTokens) {
      if (contentTokens.has(token)) hits++;
    }
    return hits / queryTokens.size;
  }
  let weightedHits = 0;
  let totalWeight = 0;
  for (const token of queryTokens) {
    const w = idf.get(token) ?? 1;
    totalWeight += w;
    if (contentTokens.has(token)) weightedHits += w;
  }
  return totalWeight === 0 ? 0 : weightedHits / totalWeight;
}

export function matchTopicsByEmbedding(
  queryEmbedding: Float32Array,
  topicEmbeddings: ReadonlyMap<string, Float32Array>,
  threshold: number,
): Set<string> {
  const matched = new Set<string>();
  for (const [topic, embedding] of topicEmbeddings) {
    if (cosineSimilarity(queryEmbedding, embedding) >= threshold) {
      matched.add(topic);
    }
  }
  return matched;
}

export function filterByTopicEmbedding<T extends { topic?: string | null }>(
  records: readonly T[],
  matchedTopics: ReadonlySet<string>,
  minSize: number,
): readonly T[] {
  if (matchedTopics.size === 0) return records;
  const filtered = records.filter((r) => r.topic && matchedTopics.has(r.topic));
  return filtered.length >= minSize ? filtered : records;
}

export function computeIdf(documents: readonly string[]): Map<string, number> {
  const n = documents.length;
  if (n === 0) return new Map();
  const df = new Map<string, number>();
  for (const doc of documents) {
    for (const token of tokenize(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log(n / count) + 1);
  }
  return idf;
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const model = getEmbeddingModel();
  if (!model) {
    throw new CodedError(
      MEMORY_ERROR_CODES.embeddingUnavailable,
      `No embedding provider for "${appConfig.embedding.model}": memory recall needs an API key.`,
    );
  }
  try {
    const result = await model.doEmbed({ values: [text] });
    const raw = result.embeddings[0];
    if (!raw) throw new Error("the embedding response carried no vector");
    return new Float32Array(raw);
  } catch (error) {
    throw new CodedError(
      MEMORY_ERROR_CODES.embeddingUnavailable,
      `Embedding request failed for "${appConfig.embedding.model}": ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function embedText(text: string): Promise<Float32Array | null> {
  try {
    return await embedQuery(text);
  } catch (error) {
    log.warn("memory.embedding.failed", { model: appConfig.embedding.model, error: errorMessage(error) });
    return null;
  }
}
