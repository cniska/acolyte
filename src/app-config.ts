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
    lastMessages: 10,
    observational: {
      scope: env.ACOLYTE_OM_SCOPE,
      thread: {
        observationTokens: env.ACOLYTE_OM_THREAD_OBSERVATION_TOKENS,
        reflectionTokens: env.ACOLYTE_OM_THREAD_REFLECTION_TOKENS,
      },
      resource: {
        observationTokens: env.ACOLYTE_OM_RESOURCE_OBSERVATION_TOKENS,
        reflectionTokens: env.ACOLYTE_OM_RESOURCE_REFLECTION_TOKENS,
      },
      observationTokens:
        env.ACOLYTE_OM_SCOPE === "thread"
          ? env.ACOLYTE_OM_THREAD_OBSERVATION_TOKENS
          : env.ACOLYTE_OM_RESOURCE_OBSERVATION_TOKENS,
      reflectionTokens:
        env.ACOLYTE_OM_SCOPE === "thread"
          ? env.ACOLYTE_OM_THREAD_REFLECTION_TOKENS
          : env.ACOLYTE_OM_RESOURCE_REFLECTION_TOKENS,
    },
  },
} as const;
