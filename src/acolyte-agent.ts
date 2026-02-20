import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { appConfig } from "./app-config";
import { acolyteTools } from "./mastra-tools";
import { getObservationalMemoryConfig } from "./memory-config";

const sharedMemory = new Memory({
  options: {
    lastMessages: appConfig.memory.lastMessages,
    observationalMemory: getObservationalMemoryConfig(),
  },
});

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function createAcolyteAgent(input: { model: string; instructions: string }): Agent {
  return new Agent({
    id: "acolyte",
    name: "Acolyte",
    instructions: input.instructions,
    model: normalizeModel(input.model),
    tools: acolyteTools,
    memory: sharedMemory,
  });
}
