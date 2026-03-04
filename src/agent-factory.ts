import type { Agent } from "./agent-contract";
import { createAgent } from "./agent-stream";
import type { Toolset } from "./tool-registry";

export type AgentInstructions = string | (() => string | Promise<string>);
export type CreateAgentInput = {
  model: string;
  instructions: AgentInstructions;
  id?: string;
  name?: string;
  tools?: Toolset;
};

export { createAgent };
export type { Agent };
