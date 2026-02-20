import { Mastra } from "@mastra/core/mastra";
import { createAcolyteAgent } from "../acolyte-agent";
import { type AgentRole, buildRoleInstructions } from "../agent-roles";
import { appConfig } from "../app-config";
import { mastraStorage } from "../mastra-storage";
import { createSoulPrompt } from "../soul";

function createRoleAgent(role: AgentRole) {
  const name = role[0].toUpperCase() + role.slice(1);
  return createAcolyteAgent({
    id: `acolyte-${role}`,
    name,
    model: appConfig.models.default,
    instructions: async () => {
      const soul = await createSoulPrompt();
      return buildRoleInstructions(soul, role);
    },
  });
}

export const acolytePlanner = createRoleAgent("planner");
export const acolyteCoder = createRoleAgent("coder");
export const acolyteReviewer = createRoleAgent("reviewer");
export const acolyte = createAcolyteAgent({
  id: "acolyte",
  name: "Acolyte",
  model: appConfig.models.default,
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
