import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { defaultCredentials } from "./agent-model";
import { appConfig } from "./app-config";
import { log } from "./log";
import { providerFromModel } from "./provider-config";

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

function createEmbeddingModel(qualifiedModel: string) {
  const creds = defaultCredentials();
  const provider = providerFromModel(qualifiedModel);
  const slash = qualifiedModel.indexOf("/");
  const modelId = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;
  const providerCreds = creds[provider] ?? {};

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      return openai.textEmbeddingModel(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      return google.textEmbeddingModel(modelId);
    }
    case "vercel": {
      const vercel = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      const gatewayModelId = qualifiedModel.startsWith("vercel/")
        ? qualifiedModel.slice("vercel/".length)
        : qualifiedModel;
      return vercel.textEmbeddingModel(gatewayModelId);
    }
    default:
      return null;
  }
}

let cachedModelId: string | null = null;
let cachedModel: ReturnType<typeof createEmbeddingModel> = null;

function getEmbeddingModel() {
  const modelId = appConfig.embeddingModel;
  if (cachedModelId === modelId && cachedModel) return cachedModel;
  cachedModel = createEmbeddingModel(modelId);
  cachedModelId = modelId;
  return cachedModel;
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

export async function embedText(text: string): Promise<Float32Array | null> {
  const model = getEmbeddingModel();
  if (!model) return null;
  try {
    const result = await model.doEmbed({ values: [text] });
    const raw = result.embeddings[0];
    if (!raw) return null;
    return new Float32Array(raw);
  } catch (error) {
    log.warn("memory.embedding.failed", { model: appConfig.embeddingModel, error: String(error) });
    return null;
  }
}
