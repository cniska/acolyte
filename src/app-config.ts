import { readResolvedConfigSync } from "./config";
import { env } from "./env";

export type PermissionMode = "read" | "write";

const fileConfig = readResolvedConfigSync();

export const appConfig = {
  server: {
    port: fileConfig.port,
    apiKey: env.ACOLYTE_API_KEY,
    apiUrl: fileConfig.apiUrl,
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
  omModel: fileConfig.omModel,
  memory: {
    resourceId: "acolyte-local",
    lastMessages: 10,
    observational: {
      scope: "resource" as const,
      observationTokens: fileConfig.omObservationTokens,
      reflectionTokens: fileConfig.omReflectionTokens,
    },
  },
  agent: {
    permissions: {
      mode: fileConfig.permissionMode,
    },
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
      read: { maxChars: 2600, maxLines: 120 },
      gitStatus: { maxChars: 1800, maxLines: 80 },
      gitDiff: { maxChars: 3200, maxLines: 120 },
      run: { maxChars: 2600, maxLines: 120 },
      edit: { maxChars: 1400, maxLines: 60 },
      create: { maxChars: 3000, maxLines: 100 },
    },
  },
} as const;

export function setPermissionMode(mode: PermissionMode): void {
  (appConfig.agent.permissions as { mode: PermissionMode }).mode = mode;
}
