import { Mastra } from "@mastra/core/mastra";
import { createAgent } from "../agent-factory";
import type { AgentRole } from "../agent-roles";
import { appConfig } from "../app-config";
import { mastraStorage } from "../mastra-storage";
import { toolsForRole } from "../mastra-tools";
import { resolveRoleModels } from "../provider-config";
import { createRoleSoulPrompt, createSoulPrompt } from "../soul";

function createRoleAgent(role: AgentRole) {
  const name = role[0].toUpperCase() + role.slice(1);
  const models = resolveRoleModels();
  const model = role === "planner" ? models.planner : role === "coder" ? models.coder : models.reviewer;
  return createAgent({
    id: `acolyte-${role}`,
    name,
    model,
    instructions: async () => createRoleSoulPrompt(role),
    tools: toolsForRole(role),
  });
}

export const acolytePlanner = createRoleAgent("planner");
export const acolyteCoder = createRoleAgent("coder");
export const acolyteReviewer = createRoleAgent("reviewer");
export const acolyte = createAgent({
  id: "acolyte",
  name: "Acolyte",
  model: appConfig.models.main,
  instructions: async () => createSoulPrompt(),
});

export const mastra = new Mastra({
  storage: mastraStorage,
  agents: {
    acolyte,
    acolytePlanner,
    acolyteCoder,
    acolyteReviewer,
  },
});
