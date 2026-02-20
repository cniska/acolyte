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

function isToolLikelyRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hints = [
    "search",
    "read",
    "file",
    "diff",
    "git",
    "status",
    "run",
    "command",
    "edit",
    "refactor",
    "find",
    "where",
    "typecheck",
    "lint",
    "test",
  ];
  return hints.some((hint) => lower.includes(hint));
}

function buildToolPolicy(baseInstructions: string): string {
  return [
    baseInstructions,
    "Tool policy:",
    "- For repository or codebase questions, prefer tools over guessing.",
    "- Use search-repo to locate relevant files before answering.",
    "- Use read-file-snippet for exact evidence and quote paths/lines when relevant.",
    "- Use git-status/git-diff when asked about current changes.",
    "- Use run-command for verification commands when requested.",
    "- Use edit-file-replace only when explicitly asked to modify files.",
  ].join("\n");
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
    instructions: buildToolPolicy(input.soulPrompt),
  });

  const requestInput = buildAgentInput(input.request);
  const toolLikely = isToolLikelyRequest(input.request.message);
  let result = await agent.generate(requestInput, {
    maxSteps: 8,
    toolChoice: "auto",
  });

  if (toolLikely && result.toolCalls.length === 0) {
    result = await agent.generate(requestInput, {
      maxSteps: 8,
      toolChoice: "required",
    });
  }

  return {
    model: input.request.model,
    output: result.text.trim(),
  };
}
