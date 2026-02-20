import { Mastra } from "@mastra/core/mastra";
import { createAcolyteAgent } from "../acolyte-agent";
import { appConfig } from "../app-config";
import { mastraStorage } from "../mastra-storage";
import { createSoulPrompt } from "../soul";

export const acolyte = createAcolyteAgent({
  model: appConfig.models.default,
  instructions: async () => createSoulPrompt(),
});

export const mastra = new Mastra({
  storage: mastraStorage,
  agents: { acolyte },
});
