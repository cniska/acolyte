import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { env } from "../env";
import { acolyteTools } from "../mastra-tools";
import { loadSystemPromptWithMemories } from "../soul";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

const model = normalizeModel(env.ACOLYTE_MODEL);
const observationalModel = normalizeModel(env.ACOLYTE_OM_MODEL ?? env.ACOLYTE_MODEL);
const memory = new Memory({
  options: {
    lastMessages: 10,
    observationalMemory: {
      model: observationalModel,
      scope: "thread",
      observation: {
        messageTokens: 20_000,
      },
      reflection: {
        observationTokens: 40_000,
      },
    },
  },
});

export const acolyte = new Agent({
  id: "acolyte",
  name: "Acolyte",
  instructions: async () => loadSystemPromptWithMemories(),
  model,
  tools: acolyteTools,
  memory,
});

export const mastra = new Mastra({
  agents: { acolyte },
});
