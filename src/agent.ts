import { Agent } from "@mastra/core/agent";
import type { ChatRequest, ChatResponse } from "./api";
import { acolyteTools } from "./mastra-tools";

interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl: string;
}

const FALLBACK_PLAN =
  "1) Interpret request. 2) Use available repo tools when helpful. 3) Return concise, actionable answer.";

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

function buildAgentInput(req: ChatRequest): string {
  const lines: string[] = [];
  const recent = req.history.slice(-16);
  for (const message of recent) {
    lines.push(`${message.role.toUpperCase()}: ${message.content}`);
  }
  lines.push(`USER: ${req.message.trim()}`);
  return lines.join("\n");
}

function buildMockReply(req: ChatRequest): ChatResponse {
  return {
    model: req.model,
    output: [
      "Remote backend is active.",
      "No OPENAI_API_KEY configured, so mock mode is enabled.",
      `Plan: ${FALLBACK_PLAN}`,
      `Echo: ${req.message.trim()}`,
    ].join(" "),
  };
}

function createAcolyteAgent(input: { model: string; instructions: string }): Agent {
  return new Agent({
    id: "acolyte",
    name: "Acolyte",
    instructions: input.instructions,
    model: normalizeModel(input.model),
    tools: acolyteTools,
  });
}

export async function runAgent(input: {
  request: ChatRequest;
  openai: OpenAIClientConfig;
  soulPrompt: string;
}): Promise<ChatResponse> {
  if (!input.openai.apiKey) {
    return buildMockReply(input.request);
  }

  const agent = createAcolyteAgent({
    model: input.request.model,
    instructions: input.soulPrompt,
  });

  const result = await agent.generate(buildAgentInput(input.request));

  return {
    model: input.request.model,
    output: result.text.trim(),
  };
}
