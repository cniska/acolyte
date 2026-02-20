import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { appConfig } from "./app-config";
import { mastraStorage } from "./mastra-storage";
import { acolyteTools } from "./mastra-tools";
import { getObservationalMemoryConfig } from "./memory-config";

const sharedMemory = new Memory({
  storage: mastraStorage,
  options: {
    lastMessages: appConfig.memory.lastMessages,
    observationalMemory: getObservationalMemoryConfig(),
  },
});

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export type AcolyteInstructions = string | (() => string | Promise<string>);

export function createAcolyteAgent(input: { model: string; instructions: AcolyteInstructions }): Agent {
  return new Agent({
    id: "acolyte",
    name: "Acolyte",
    instructions: input.instructions,
    model: normalizeModel(input.model),
    tools: acolyteTools,
    memory: sharedMemory,
  });
}
