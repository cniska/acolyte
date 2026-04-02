import { readResolvedConfigSync } from "./config";
import { env } from "./env";

const fileConfig = readResolvedConfigSync();

export const appConfig = {
  locale: fileConfig.locale,
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
  model: fileConfig.model,
  temperature: fileConfig.temperature,
  distill: {
    model: fileConfig.distillModel,
  },
  embedding: {
    model: fileConfig.embeddingModel,
  },
} as const;

export function setModel(model: string): void {
  (appConfig as { model: string }).model = model;
}
