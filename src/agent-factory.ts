import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { appConfig } from "./app-config";
import { mastraStorage } from "./mastra-storage";
import { type Toolset, toolsForAgent } from "./mastra-tools";
import { getObservationalMemoryConfig } from "./memory-config";
import { normalizeModel } from "./provider-config";

const sharedMemory = new Memory({
  storage: mastraStorage,
  options: {
    lastMessages: appConfig.memory.lastMessages,
    observationalMemory: getObservationalMemoryConfig(),
  },
});

export type AgentInstructions = string | (() => string | Promise<string>);
export type CreateAcolyteInput = {
  model: string;
  instructions: AgentInstructions;
  tools?: Partial<Toolset>;
};

export function createAgent(input: {
  model: string;
  instructions: AgentInstructions;
  id?: string;
  name?: string;
  tools?: Partial<Toolset>;
}): Agent {
  return new Agent({
    id: input.id ?? "acolyte",
    name: input.name ?? "Acolyte",
    instructions: input.instructions,
    model: normalizeModel(input.model),
    maxRetries: 1,
    tools: input.tools ?? toolsForAgent().tools,
    memory: sharedMemory,
  });
}

export function createAcolyte(input: CreateAcolyteInput): Agent {
  return createAgent({
    model: input.model,
    instructions: input.instructions,
    tools: input.tools,
  });
}
