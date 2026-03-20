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
    default:
      return null;
  }
}

let cachedModelId: string | null = null;
let cachedModel: ReturnType<typeof createEmbeddingModel> = null;

function getEmbeddingModel() {
  const modelId = appConfig.embedding.model;
  if (cachedModelId === modelId && cachedModel) return cachedModel;
  cachedModel = createEmbeddingModel(modelId);
  cachedModelId = modelId;
  return cachedModel;
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
    log.warn("memory.embedding.failed", { model: appConfig.embedding.model, error: String(error) });
    return null;
  }
}
