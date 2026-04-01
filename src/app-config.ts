import { readResolvedConfigSync } from "./config";
import { env } from "./env";

const fileConfig = readResolvedConfigSync();

export const appConfig = {
  locale: fileConfig.locale,
  server: {
    port: fileConfig.port,
    apiKey: env.ACOLYTE_API_KEY,
    transportMode: fileConfig.transportMode,
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
    messageThreshold: fileConfig.distillMessageThreshold,
    maxOutputTokens: fileConfig.distillMaxOutputTokens,
  },
  memory: {
    budgetTokens: fileConfig.memoryBudgetTokens,
  },
  embedding: {
    model: fileConfig.embeddingModel,
  },
  agent: {
    contextMaxTokens: fileConfig.contextMaxTokens,
    inputBudget: {
      maxHistoryMessages: fileConfig.maxHistoryMessages,
      maxMessageTokens: fileConfig.maxMessageTokens,
      maxAttachmentMessageTokens: fileConfig.maxAttachmentMessageTokens,
      maxPinnedMessageTokens: fileConfig.maxPinnedMessageTokens,
    },
    toolOutputBudget: {
      findFiles: { maxChars: 2500, maxLines: 100 },
      searchFiles: { maxChars: 2200, maxLines: 80 },
      webSearch: { maxChars: 2400, maxLines: 80 },
      webFetch: { maxChars: 2600, maxLines: 90 },
      read: { maxChars: 80_000, maxLines: 2000 },
      gitStatus: { maxChars: 1800, maxLines: 80 },
      gitDiff: { maxChars: 3200, maxLines: 120 },
      run: { maxChars: 2600, maxLines: 120 },
      edit: { maxChars: 1400, maxLines: 60 },
      astEdit: { maxChars: 1400, maxLines: 60 },
      scanCode: { maxChars: 2400, maxLines: 80 },
      create: { maxChars: 3000, maxLines: 100 },
    },
    skillBudget: { maxChars: 4000, maxLines: 120 },
  },
} as const;

export function setModel(model: string): void {
  (appConfig as { model: string }).model = model;
}
