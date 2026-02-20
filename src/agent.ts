import { Agent } from "@mastra/core/agent";
import { relative } from "node:path";
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
    "Response style policy:",
    "- Keep tool-result responses compact and user-focused.",
    "- Do not start with conversational preambles like 'Done', 'Great', 'Sure', or similar.",
    "- Prefer a short status line plus at most 3 concise bullets when summarizing command results.",
    "- Do not add optional next-step menus unless the user asks for options.",
    "- Do not restate capabilities after normal command/task confirmations.",
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

function toolNameList(toolCalls: Array<{ payload?: { toolName?: string } }>): string[] {
  const names = new Set<string>();
  for (const call of toolCalls) {
    const name = call?.payload?.toolName;
    if (name) {
      names.add(name);
    }
  }
  return [...names];
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object" && "result" in (result as Record<string, unknown>)) {
    const inner = (result as Record<string, unknown>).result;
    if (typeof inner === "string") {
      return inner;
    }
  }
  return "";
}

function normalizePath(pathInput: string): string {
  const rel = relative(process.cwd(), pathInput);
  if (!rel || rel.startsWith("..")) {
    return pathInput;
  }
  return rel;
}

function extractEvidencePaths(toolResults: Array<{ payload?: { toolName?: string; result?: unknown } }>): string[] {
  const paths = new Set<string>();

  for (const item of toolResults) {
    const toolName = item?.payload?.toolName ?? "";
    const text = stringifyToolResult(item?.payload?.result);
    if (!text) {
      continue;
    }

    if (toolName === "search-repo") {
      const line = text.split("\n").find((row) => row.startsWith("./") && row.includes(":"));
      if (line) {
        const match = line.match(/^\.\/([^:]+):\d+:/);
        if (match?.[1]) {
          paths.add(match[1]);
        }
      }
    }

    if (toolName === "read-file-snippet") {
      const line = text.split("\n").find((row) => row.startsWith("File: "));
      if (line) {
        const file = line.replace(/^File:\s+/, "").trim();
        if (file) {
          paths.add(normalizePath(file));
        }
      }
    }
  }

  return [...paths].slice(0, 3);
}

function buildToolTransparency(input: {
  toolCalls: Array<{ payload?: { toolName?: string } }>;
  toolResults: Array<{ payload?: { toolName?: string; result?: unknown } }>;
}): string {
  const names = toolNameList(input.toolCalls);
  if (names.length === 0) {
    return "";
  }

  const evidence = extractEvidencePaths(input.toolResults);
  const lines = [`Tools used: ${names.join(", ")}`];
  if (evidence.length > 0) {
    lines.push(`Evidence: ${evidence.join(", ")}`);
  }
  return lines.join("\n");
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

  const toolCalls = (result.toolCalls ?? []) as Array<{ payload?: { toolName?: string } }>;
  const toolResults = (result.toolResults ?? []) as Array<{
    payload?: { toolName?: string; result?: unknown };
  }>;
  const transparency = buildToolTransparency({ toolCalls, toolResults });
  const output = transparency ? `${result.text.trim()}\n\n${transparency}` : result.text.trim();

  return {
    model: input.request.model,
    output,
  };
}
