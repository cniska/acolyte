import { env } from "./env";

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
  models: {
    default: env.ACOLYTE_MODEL,
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
    contextMaxTokens: env.ACOLYTE_CONTEXT_MAX_TOKENS,
  },
} as const;
