import { appConfig } from "./app-config";
import { normalizeModel } from "./provider-config";

export function getObservationalMemoryConfig(): {
  model: string;
  scope: "resource";
  observation: { messageTokens: number };
  reflection: { observationTokens: number };
} {
  return {
    model: normalizeModel(appConfig.omModel),
    scope: appConfig.memory.observational.scope,
    observation: {
      messageTokens: appConfig.memory.observational.observationTokens,
    },
    reflection: {
      observationTokens: appConfig.memory.observational.reflectionTokens,
    },
  };
}
