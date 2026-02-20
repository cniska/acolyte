import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { acolyteTools } from "../mastra-tools";
import { loadSystemPrompt } from "../soul";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

const model = normalizeModel(process.env.ACOLYTE_MODEL ?? "gpt-5-mini");

export const acolyte = new Agent({
  id: "acolyte",
  name: "Acolyte",
  instructions: loadSystemPrompt(),
  model,
  tools: acolyteTools,
});

export const mastra = new Mastra({
  agents: { acolyte },
});
