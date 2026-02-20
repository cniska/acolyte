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

export type AgentInstructions = string | (() => string | Promise<string>);

export function createAgent(input: {
  model: string;
  instructions: AgentInstructions;
  id?: string;
  name?: string;
}): Agent {
  return new Agent({
    id: input.id ?? "acolyte",
    name: input.name ?? "Acolyte",
    instructions: input.instructions,
    model: normalizeModel(input.model),
    tools: acolyteTools,
    memory: sharedMemory,
  });
}
