import { appConfig } from "./app-config";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function getObservationalMemoryConfig(): {
  model: string;
  scope: "resource";
  observation: { messageTokens: number };
  reflection: { observationTokens: number };
} {
  return {
    model: normalizeModel(appConfig.models.observationalMemory),
    scope: appConfig.memory.observational.scope,
    observation: {
      messageTokens: appConfig.memory.observational.observationTokens,
    },
    reflection: {
      observationTokens: appConfig.memory.observational.reflectionTokens,
    },
  };
}
