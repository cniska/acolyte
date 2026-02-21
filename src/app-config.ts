import { env } from "./env";

export type PermissionMode = "read" | "write";
export type ModelProvider = "openai" | "anthropic" | "gemini" | "openai-compatible" | "mock";

export const appConfig = {
  server: {
    port: env.PORT,
    apiKey: env.ACOLYTE_API_KEY,
    apiUrl: env.ACOLYTE_API_URL,
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
  },
  google: {
    apiKey: env.GOOGLE_API_KEY,
    baseUrl: env.GOOGLE_BASE_URL,
  },
  providers: {
    main: env.ACOLYTE_PROVIDER,
    planner: env.ACOLYTE_PROVIDER_PLANNER,
    coder: env.ACOLYTE_PROVIDER_CODER,
    reviewer: env.ACOLYTE_PROVIDER_REVIEWER,
  },
  models: {
    main: env.ACOLYTE_MODEL,
    planner: env.ACOLYTE_MODEL_PLANNER,
    coder: env.ACOLYTE_MODEL_CODER,
    reviewer: env.ACOLYTE_MODEL_REVIEWER,
    observationalMemory: env.ACOLYTE_OM_MODEL ?? env.ACOLYTE_MODEL,
  },
  memory: {
    resourceId: "acolyte-local",
    lastMessages: 10,
    observational: {
      scope: "resource" as const,
      observationTokens: env.ACOLYTE_OM_OBSERVATION_TOKENS,
      reflectionTokens: env.ACOLYTE_OM_REFLECTION_TOKENS,
    },
  },
  agent: {
    permissions: {
      mode: env.ACOLYTE_PERMISSION_MODE,
    },
    contextMaxTokens: env.ACOLYTE_CONTEXT_MAX_TOKENS,
    inputBudget: {
      maxHistoryMessages: env.ACOLYTE_MAX_HISTORY_MESSAGES,
      maxMessageTokens: env.ACOLYTE_MAX_MESSAGE_TOKENS,
      maxAttachmentMessageTokens: env.ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS,
      maxPinnedMessageTokens: env.ACOLYTE_MAX_PINNED_MESSAGE_TOKENS,
    },
    toolOutputBudget: {
      search: { maxChars: 2200, maxLines: 80 },
      webSearch: { maxChars: 2400, maxLines: 80 },
      webFetch: { maxChars: 2600, maxLines: 90 },
      read: { maxChars: 2600, maxLines: 120 },
      gitStatus: { maxChars: 1800, maxLines: 80 },
      gitDiff: { maxChars: 3200, maxLines: 120 },
      run: { maxChars: 2600, maxLines: 120 },
      edit: { maxChars: 1400, maxLines: 60 },
    },
  },
} as const;

export function setPermissionMode(mode: PermissionMode): void {
  (appConfig.agent.permissions as { mode: PermissionMode }).mode = mode;
}
