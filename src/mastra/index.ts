import { Mastra } from "@mastra/core/mastra";
import { appConfig } from "../app-config";
import { createAcolyteAgent } from "../acolyte-agent";
import { loadSystemPromptWithMemories } from "../soul";

export const acolyte = createAcolyteAgent({
  model: appConfig.models.default,
  instructions: async () => loadSystemPromptWithMemories(),
});

export const mastra = new Mastra({
  agents: { acolyte },
});
