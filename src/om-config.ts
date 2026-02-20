import { env } from "./env";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function getObservationalMemoryConfig(): {
  model: string;
  scope: "thread";
  observation: { messageTokens: number };
  reflection: { observationTokens: number };
} {
  return {
    model: normalizeModel(env.ACOLYTE_OM_MODEL ?? env.ACOLYTE_MODEL),
    scope: "thread",
    observation: {
      messageTokens: env.ACOLYTE_OM_OBSERVATION_TOKENS,
    },
    reflection: {
      observationTokens: env.ACOLYTE_OM_REFLECTION_TOKENS,
    },
  };
}
