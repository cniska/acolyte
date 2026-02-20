import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { env } from "../env";
import { acolyteTools } from "../mastra-tools";
import { getObservationalMemoryConfig } from "../memory-config";
import { loadSystemPromptWithMemories } from "../soul";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

const model = normalizeModel(env.ACOLYTE_MODEL);
const memory = new Memory({
  options: {
    lastMessages: 10,
    observationalMemory: getObservationalMemoryConfig(),
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
