import { readResolvedConfigSync } from "./config";
import { env } from "./env";

const fileConfig = readResolvedConfigSync();

export const appConfig = {
  locale: fileConfig.locale,
  features: fileConfig.features,
  server: {
    port: fileConfig.port,
    apiKey: env.ACOLYTE_API_KEY,
    replyTimeoutMs: fileConfig.replyTimeoutMs,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: fileConfig.openaiBaseUrl,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: fileConfig.anthropicBaseUrl,
  },
  google: {
    apiKey: env.GOOGLE_API_KEY,
    baseUrl: fileConfig.googleBaseUrl,
  },
  vercel: {
    apiKey: env.AI_GATEWAY_API_KEY,
    baseUrl: fileConfig.vercelBaseUrl,
  },
  model: fileConfig.model,
  temperature: fileConfig.temperature,
  reasoning: fileConfig.reasoning,
  distillModel: fileConfig.distillModel,
  embeddingModel: fileConfig.embeddingModel,
  cloudUrl: fileConfig.cloudUrl,
  cloudToken: env.ACOLYTE_CLOUD_TOKEN,
} as const;

export function setModel(model: string): void {
  (appConfig as { model: string }).model = model;
}
