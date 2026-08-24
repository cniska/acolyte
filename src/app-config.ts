import { readResolvedConfigSync } from "./config";
import { readCredentialsSync, readProviderApiKeysSync } from "./credentials";
import { env } from "./env";

const fileConfig = readResolvedConfigSync();
const credentials = readCredentialsSync();
const providerApiKeys = readProviderApiKeysSync();

export const appConfig = {
  locale: fileConfig.locale,
  features: fileConfig.features,
  server: {
    port: fileConfig.port,
    apiKey: env.ACOLYTE_API_KEY,
    replyTimeoutMs: fileConfig.replyTimeoutMs,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY ?? providerApiKeys.OPENAI_API_KEY,
    baseUrl: fileConfig.openaiBaseUrl,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY ?? providerApiKeys.ANTHROPIC_API_KEY,
    baseUrl: fileConfig.anthropicBaseUrl,
  },
  google: {
    apiKey: env.GOOGLE_API_KEY ?? providerApiKeys.GOOGLE_API_KEY,
    baseUrl: fileConfig.googleBaseUrl,
  },
  vercel: {
    apiKey: env.AI_GATEWAY_API_KEY ?? providerApiKeys.AI_GATEWAY_API_KEY,
    baseUrl: fileConfig.vercelBaseUrl,
  },
  model: fileConfig.model,
  reasoning: fileConfig.reasoning,
  distillModel: fileConfig.distillModel,
  embedding: {
    model: fileConfig.embeddingModel,
    baseUrl: fileConfig.embeddingBaseUrl,
    apiKey: env.ACOLYTE_EMBEDDING_API_KEY ?? credentials.embeddingApiKey,
  },
  cloudUrl: env.ACOLYTE_CLOUD_URL ?? credentials.cloudUrl,
  cloudToken: env.ACOLYTE_CLOUD_TOKEN ?? credentials.cloudToken,
} as const;

export function setModel(model: string): void {
  (appConfig as { model: string }).model = model;
}
