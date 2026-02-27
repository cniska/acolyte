import { Mastra } from "@mastra/core/mastra";
import { createAcolyte } from "../agent-factory";
import { appConfig } from "../app-config";
import { mastraStorage } from "../mastra-storage";
import { toolsForAgent } from "../mastra-tools";
import { createSoulPrompt } from "../soul";
export const acolyte = createAcolyte({
  model: appConfig.model,
  instructions: async () => createSoulPrompt(),
  tools: toolsForAgent().tools,
});

export const mastra = new Mastra({
  storage: mastraStorage,
  agents: {
    acolyte,
  },
});
