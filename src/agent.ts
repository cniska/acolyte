import { createAgent } from "./agent-factory";
import { type AgentRole, buildRoleInstructions, buildSubagentContext, selectAgentRole } from "./agent-roles";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import { toolsForRole } from "./mastra-tools";
import { resolveRoleModel } from "./provider-config";
import { loadRoleSoulPrompt } from "./soul";

interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl: string;
}

const FALLBACK_PLAN =
  "1) Interpret request. 2) Use available repo tools when helpful. 3) Return concise, actionable answer.";
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_REVIEW_OUTPUT_CHARS = 1800;
const MAX_ASSISTANT_OUTPUT_CHARS = 1400;
const MAX_WHAT_NEXT_STEP_CHARS = 180;

function estimateTokens(input: string): number {
  if (input.length === 0) {
    return 0;
  }
  return Math.ceil(input.length / APPROX_CHARS_PER_TOKEN);
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isRelevantFileContext(content: string): boolean {
  return content.startsWith("Attached file:") || content.startsWith("Attached directory:");
}

function isPinnedSystemContext(content: string): boolean {
  return content.startsWith("Active skill (") || content.startsWith("Pinned memory:");
}

function lineForMessage(message: ChatRequest["history"][number], maxTokens: number): { line: string; tokens: number } {
  const compact = truncateByTokens(message.content, maxTokens);
  const line = `${message.role.toUpperCase()}: ${compact}`;
  return { line, tokens: estimateTokens(line) };
}

function collectLinesWithinBudget(
  messages: ChatRequest["history"],
  usedIds: Set<string>,
  remainingTokens: number,
  maxPerMessageTokens: number,
): { lines: string[]; consumedTokens: number } {
  const lines: string[] = [];
  let consumed = 0;
  const recent = messages.slice(-appConfig.agent.inputBudget.maxHistoryMessages);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    if (usedIds.has(message.id)) {
      continue;
    }
    const candidate = lineForMessage(message, maxPerMessageTokens);
    if (candidate.tokens === 0 || consumed + candidate.tokens > remainingTokens) {
      continue;
    }
    usedIds.add(message.id);
    lines.unshift(candidate.line);
    consumed += candidate.tokens;
  }
  return { lines, consumedTokens: consumed };
}

export function buildAgentInput(req: ChatRequest): string {
  return buildAgentInputWithUsage(req).input;
}

function buildAgentInputWithUsage(req: ChatRequest): {
  input: string;
  usage: {
    promptTokens: number;
    promptBudgetTokens: number;
    promptTruncated: boolean;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
  };
} {
  const maxContextTokens = appConfig.agent.contextMaxTokens;
  const lines: string[] = [];
  const usedIds = new Set<string>();
  const budget = appConfig.agent.inputBudget;

  const userLine = `USER: ${truncateByTokens(req.message.trim(), budget.maxMessageTokens)}`;
  const userTokens = estimateTokens(userLine);
  let remaining = Math.max(0, maxContextTokens - userTokens);

  const pinnedSystem = req.history.filter(
    (message) => message.role === "system" && isPinnedSystemContext(message.content),
  );
  const pinnedResult = collectLinesWithinBudget(pinnedSystem, usedIds, remaining, budget.maxPinnedMessageTokens);
  lines.push(...pinnedResult.lines);
  remaining -= pinnedResult.consumedTokens;

  const relevantFiles = req.history.filter(
    (message) => message.role === "system" && isRelevantFileContext(message.content),
  );
  const filesResult = collectLinesWithinBudget(relevantFiles, usedIds, remaining, budget.maxAttachmentMessageTokens);
  lines.push(...filesResult.lines);
  remaining -= filesResult.consumedTokens;

  const recentResult = collectLinesWithinBudget(req.history, usedIds, remaining, budget.maxMessageTokens);
  lines.push(...recentResult.lines);

  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(userLine);
  const input = lines.join("\n");
  const promptTokens = estimateTokens(input);
  return {
    input,
    usage: {
      promptTokens,
      promptBudgetTokens: maxContextTokens,
      promptTruncated: usedIds.size < req.history.length,
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
    },
  };
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

export { buildSubagentContext, selectAgentRole };

export function resolveAgentModel(
  role: AgentRole,
  requestedModel: string,
  overrides: {
    planner?: string;
    coder?: string;
    reviewer?: string;
  } = appConfig.models,
): string {
  return resolveRoleModel(role, requestedModel, overrides);
}

export function compactReviewOutput(output: string): string {
  if (output.length <= MAX_REVIEW_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, Math.max(0, MAX_REVIEW_OUTPUT_CHARS - 1))}…`;
}

function compactAssistantOutput(output: string): string {
  if (output.length <= MAX_ASSISTANT_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, Math.max(0, MAX_ASSISTANT_OUTPUT_CHARS - 1))}…`;
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

function isWhatNextPrompt(text: string): boolean {
  return /^(what('?s|\s+is)?\s+next)\??$/i.test(text.trim());
}

function isGreetingPrompt(text: string): boolean {
  return /^(hi|hello|hey|yo|sup)\b[!.?]*$/i.test(text.trim());
}

function compactWhatNextStep(step: string): string {
  let compact = step
    .replace(/\s+/g, " ")
    .replace(/^if\s+you\s+approve[^,]*,\s*/i, "")
    .replace(/^if\s+verification\s+passes,\s*/i, "")
    .replace(/^quick\s+(recap|status)[:\-]\s*/i, "")
    .trim();
  compact = compact.replace(/\bpush and open a PR\b/gi, "commit and share results");
  compact = compact.replace(/\bopen a PR\b/gi, "share results");
  compact = compact.replace(/,\s*I(?:'|’)ll[^.;]*$/i, "");
  compact = compact.replace(/^commit with .*?,\s*commit and share results/gi, "commit and share results");
  compact = compact.replace(/\s+/g, " ").trim();
  if (compact.length > MAX_WHAT_NEXT_STEP_CHARS) {
    compact = `${compact.slice(0, Math.max(0, MAX_WHAT_NEXT_STEP_CHARS - 1)).trimEnd()}…`;
  }
  const stripped = compact.replace(/[.;]\s*$/g, "").trim();
  if (stripped.length === 0) {
    return stripped;
  }
  return `${stripped.slice(0, 1).toUpperCase()}${stripped.slice(1)}`;
}

function normalizeWhatNextOutput(output: string): string {
  const numbered = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => {
      const body = line.replace(/^\d+\.\s+/, "");
      return body.length > 0 ? body : "";
    })
    .map(compactWhatNextStep)
    .filter((line) => line.length > 0)
    .map((line, index) => `${index + 1}. ${line}`)
    .slice(0, 3);
  if (numbered.length >= 3) {
    return numbered.join("\n");
  }

  const inline = output.replace(/\s+/g, " ").trim();
  const markers = Array.from(inline.matchAll(/(?:^|\s)(\d+)\.\s+/g));
  if (markers.length >= 2) {
    const steps: string[] = [];
    for (let i = 0; i < markers.length && steps.length < 3; i += 1) {
      const marker = markers[i];
      const start = (marker.index ?? 0) + marker[0].length;
      const end = i + 1 < markers.length ? (markers[i + 1].index ?? inline.length) : inline.length;
      const body = inline.slice(start, end).trim();
      if (body.length === 0) {
        continue;
      }
      const compact = compactWhatNextStep(body);
      if (compact.length === 0) {
        continue;
      }
      steps.push(`${steps.length + 1}. ${compact}`);
    }
    if (steps.length >= 2) {
      while (steps.length < 3) {
        steps.push(`${steps.length + 1}. Continue with the next highest-impact step and verify.`);
      }
      return steps.slice(0, 3).join("\n");
    }
  }

  const candidates = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(what next|recap|quick|ready|pick one|reply|which option)/i.test(line))
    .map(compactWhatNextStep)
    .filter((line) => line.length > 0)
    .slice(0, 3);
  if (candidates.length === 0) {
    return "1. Confirm the target file or task.\n2. Apply the smallest safe change.\n3. Run verify and report result.";
  }
  return candidates.map((line, index) => `${index + 1}. ${line.replace(/^\d+[.)]\s+/, "")}`).join("\n");
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
    return `No review output produced for @${mentionedPath}. Try narrowing the scope (for example ${suggestNarrowerReviewScope(mentionedPath)}) or rephrasing your prompt.`;
  }
  return "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your prompt.";
}

export function finalizeAssistantOutput(output: string, message = ""): string {
  if (isGreetingPrompt(message)) {
    return "Hi - ready. What should we work on?";
  }

  const normalizedOptions = output
    .split("\n")
    .map((line) => {
      const numberedMatch = line.match(/^(\s*)(\d+)\)\s+(.*)$/);
      if (numberedMatch) {
        return `${numberedMatch[1] ?? ""}${numberedMatch[2] ?? "1"}. ${numberedMatch[3] ?? ""}`;
      }
      const match = line.match(/^(\s*)([A-Ca-c])\s*[-—:)]\s+(.*)$/);
      if (!match) {
        return line;
      }
      const index = (match[2]?.toUpperCase().charCodeAt(0) ?? 65) - 64;
      return `${match[1] ?? ""}${index}. ${match[3] ?? ""}`;
    })
    .join("\n");

  let dropAuxSection = false;
  const cleaned = normalizedOptions
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        dropAuxSection = false;
        return true;
      }
      if (
        /^(quick recap|quick summary|repo context|pick one action|quick status|quick options|quick reminders?|quick context)\b/i.test(
          trimmed,
        )
      ) {
        dropAuxSection = true;
        return false;
      }
      if (/^(notes?\s*\/?\s*blockers?|next-action options?|next actions?|next steps?)\b/i.test(trimmed)) {
        dropAuxSection = true;
        return false;
      }
      if (/^recap\s*[:\-]/i.test(trimmed)) {
        return false;
      }
      if (/^i can:\s*$/i.test(trimmed)) {
        dropAuxSection = true;
        return false;
      }
      if (/^if you want,?\s*i can\s*:?\s*$/i.test(trimmed)) {
        dropAuxSection = true;
        return false;
      }
      if (dropAuxSection && (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed))) {
        return false;
      }
      if (/^ready[,.!]/i.test(trimmed)) {
        return false;
      }
      if (/^recommendation\s*[—-]\s*do\s*[abc]\b/i.test(trimmed)) {
        dropAuxSection = true;
        return false;
      }
      if (/^pick one(?:\s+[a-z]+)*:?\s*$/i.test(trimmed)) {
        dropAuxSection = true;
        return false;
      }
      if (/^next actions?\s*\(pick one\)\s*:?\s*$/i.test(trimmed)) {
        return false;
      }
      if (/^which option\b/i.test(trimmed)) {
        return false;
      }
      if (/^which (do you want|one do you want)\b/i.test(trimmed)) {
        return false;
      }
      if (/^reply\s+[a-z](\s*,\s*[a-z])*\s*(or\s*[a-z])?/i.test(trimmed)) {
        return false;
      }
      if (/^reply\s+\d+(\s*,\s*\d+)*\s*(or\s*\d+)?/i.test(trimmed)) {
        return false;
      }
      if (/^[abc]\s*[-—:)]/i.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length > 0) {
    if (isWhatNextPrompt(message)) {
      return compactAssistantOutput(normalizeWhatNextOutput(cleaned));
    }
    return compactAssistantOutput(cleaned);
  }
  return "No output produced. Try rephrasing your prompt.";
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

export async function runAgent(input: {
  request: ChatRequest;
  openai: OpenAIClientConfig;
  soulPrompt: string;
}): Promise<ChatResponse> {
  if (!input.openai.apiKey) {
    return buildMockReply(input.request);
  }

  const role = selectAgentRole(input.request.message);
  const roleSoul = loadRoleSoulPrompt(role);
  const model = resolveAgentModel(role, input.request.model);

  const agent = createAgent({
    id: `acolyte-${role}`,
    name: `Acolyte ${role[0].toUpperCase()}${role.slice(1)}`,
    model,
    instructions: buildRoleInstructions(input.soulPrompt, role, roleSoul),
    tools: toolsForRole(role),
  });

  const requestInput = buildAgentInputWithUsage(input.request);
  const subagentContext = buildSubagentContext(role, input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;
  const toolLikely = isToolLikelyRequest(input.request.message);
  const memoryOptions = input.request.sessionId
    ? { thread: input.request.sessionId, resource: appConfig.memory.resourceId }
    : undefined;
  let result = await agent.generate(agentInput, {
    maxSteps: role === "planner" ? 5 : 8,
    toolChoice: "auto",
    memory: memoryOptions,
  });

  const shouldRequireToolsFallback = role !== "planner" && (toolLikely || role === "reviewer");
  if (shouldRequireToolsFallback && result.toolCalls.length === 0) {
    result = await agent.generate(agentInput, {
      maxSteps: 8,
      toolChoice: "required",
      memory: memoryOptions,
    });
  }

  const rawOutput = result.text.trim();
  const output = isReviewRequest(input.request.message)
    ? finalizeReviewOutput(rawOutput, input.request.message)
    : finalizeAssistantOutput(rawOutput, input.request.message);
  const completionTokens = estimateTokens(output);
  const promptUsage = requestInput.usage;
  let budgetWarning: string | undefined;
  if (promptUsage.promptTruncated) {
    budgetWarning = `context trimmed (${promptUsage.includedHistoryMessages}/${promptUsage.totalHistoryMessages} history messages)`;
  } else if (promptUsage.promptTokens >= Math.floor(promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = `context near budget (${promptUsage.promptTokens}/${promptUsage.promptBudgetTokens} tokens)`;
  }

  return {
    model,
    output,
    usage: {
      promptTokens: promptUsage.promptTokens,
      completionTokens,
      totalTokens: promptUsage.promptTokens + completionTokens,
      promptBudgetTokens: promptUsage.promptBudgetTokens,
      promptTruncated: promptUsage.promptTruncated,
    },
    budgetWarning,
  };
}
