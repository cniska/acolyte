import { Agent } from "@mastra/core/agent";
import type { ChatRequest, ChatResponse } from "./api";
import { acolyteTools } from "./mastra-tools";

interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl: string;
}

const FALLBACK_PLAN =
  "1) Interpret request. 2) Use available repo tools when helpful. 3) Return concise, actionable answer.";
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_TOTAL_CHARS = 40_000;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_ATTACHMENT_MESSAGE_CHARS = 20_000;
const MAX_REVIEW_OUTPUT_CHARS = 1800;

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

function messageCharLimit(content: string): number {
  if (content.startsWith("Attached file:")) {
    return MAX_ATTACHMENT_MESSAGE_CHARS;
  }
  return MAX_MESSAGE_CHARS;
}

export function buildAgentInput(req: ChatRequest): string {
  const lines: string[] = [];
  const recent = req.history.slice(-MAX_HISTORY_MESSAGES);
  let usedChars = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    const compact = truncateText(message.content, messageCharLimit(message.content));
    const line = `${message.role.toUpperCase()}: ${compact}`;
    if (usedChars + line.length > MAX_HISTORY_TOTAL_CHARS) {
      break;
    }
    lines.unshift(line);
    usedChars += line.length;
  }
  lines.push(`USER: ${truncateText(req.message.trim(), MAX_MESSAGE_CHARS)}`);
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

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

export function compactReviewOutput(output: string): string {
  if (output.length <= MAX_REVIEW_OUTPUT_CHARS) {
    return output;
  }
  return truncateText(output, MAX_REVIEW_OUTPUT_CHARS);
}

export function normalizeReviewOutput(output: string): string {
  const lines = output.split("\n");
  const normalized = lines.map((line, index) => {
    const trimmedRight = line.trimEnd();

    if (index === 0) {
      const headerMatch = trimmedRight.match(/^\s*[•*-]?\s*(\d+)\s+findings?\s+in\s+(.+)\s*$/i);
      if (headerMatch) {
        const count = Number.parseInt(headerMatch[1] ?? "0", 10);
        const scope = (headerMatch[2] ?? "").replace(/^@/, "").trim();
        const label = count === 1 ? "finding" : "findings";
        return `${count} ${label} in ${scope}`;
      }
    }

    const numbered = trimmedRight.match(/^\s*(\d+)[\)\.]?\s+(.*)$/);
    if (numbered) {
      const num = numbered[1];
      const body = numbered[2]?.trim() ?? "";
      return `${num}. ${body}`;
    }

    return trimmedRight;
  });

  return normalized.join("\n").trimEnd();
}

function extractMentionedPath(message: string): string | null {
  const match = message.match(/@([^\s]+)/);
  if (!match) {
    return null;
  }
  const cleaned = (match[1] ?? "").replace(/[.,;:!?]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function suggestNarrowerReviewScope(path: string): string {
  const clean = path.replace(/\/+$/, "");
  if (clean.length === 0) {
    return "@src/agent.ts";
  }
  if (clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".js") || clean.endsWith(".md")) {
    return `@${clean}`;
  }
  return `@${clean}/agent.ts`;
}

export function finalizeReviewOutput(output: string, message = ""): string {
  const cleaned = output
    .split("\n")
    .filter((line) => !/^\s*(Tools used:|Evidence:)/.test(line))
    .join("\n")
    .trim();
  const normalized = normalizeReviewOutput(compactReviewOutput(cleaned));
  if (normalized.trim().length > 0) {
    return normalized;
  }
  const mentionedPath = extractMentionedPath(message);
  if (mentionedPath) {
    return `No review output produced for @${mentionedPath}. Try narrowing the scope (for example ${suggestNarrowerReviewScope(mentionedPath)}) or rephrasing your question.`;
  }
  return "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your question.";
}

export function finalizeAssistantOutput(output: string): string {
  const cleaned = output.trim();
  if (cleaned.length > 0) {
    return cleaned;
  }
  return "No output produced. Try rephrasing your question.";
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
    "Review response policy:",
    "- For review requests, prioritize concrete findings first (bugs/risks/regressions), ordered by severity.",
    "- Keep reviews concise: default to up to 3 high-signal findings unless the user asks for more.",
    "- If only 1-2 meaningful findings exist, return only those instead of padding.",
    "- Use this compact structure: first line `<N> findings in <scope>`, then numbered findings.",
    "- In `<scope>`, use plain file scope (for example `src/file.ts`), not `@src/file.ts`.",
    "- Number findings using `1.`, `2.`, `3.` style.",
    "- Do not indent numbered findings; each finding line must start directly with `1.`, `2.`, or `3.`.",
    "- Prefer this hybrid layout per finding (max 2 lines):",
    "  1) `1. <short title> (<severity>)`",
    "  2) `<path:line> — <evidence>; <recommendation>`",
    "- Keep wording compact and avoid long prose blocks.",
    "- Do not use verbose `Evidence:`/`Recommendation:` blocks unless explicitly requested.",
    "- Include file references in each finding when available (path:line).",
    "- Prefer single path:line references instead of broad line ranges when possible.",
    "- Do not add extra sections (summary, optional improvements, next steps, menus) unless explicitly requested.",
    "- Ground each finding in repo/file evidence and avoid generic process advice unless explicitly requested.",
    "- If evidence is incomplete, state that briefly instead of guessing broad recommendations.",
    "- Do not end with questions like 'which do you prefer?' unless the user explicitly asked for options.",
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

  const rawOutput = result.text.trim();
  const output = isReviewRequest(input.request.message)
    ? finalizeReviewOutput(rawOutput, input.request.message)
    : finalizeAssistantOutput(rawOutput);

  return {
    model: input.request.model,
    output,
  };
}
