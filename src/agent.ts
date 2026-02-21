import { createAgent } from "./agent-factory";
import { type AgentRole, buildRoleInstructions, buildSubagentContext, selectAgentRole } from "./agent-roles";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import { toolsForRole } from "./mastra-tools";
import { isProviderAvailable, type ModelProviderName, providerFromModel, resolveRoleModel } from "./provider-config";
import { loadRoleSoulPrompt } from "./soul";

const FALLBACK_PLAN =
  "1) Interpret request. 2) Use available repo tools when helpful. 3) Return concise, actionable answer.";
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_REVIEW_OUTPUT_CHARS = 1800;
const MAX_ASSISTANT_OUTPUT_CHARS = 1200;

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

export function resolveModelProviderState(
  model: string,
  credentials: {
    openaiApiKey?: string;
    openaiBaseUrl: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  } = {
    openaiApiKey: appConfig.openai.apiKey,
    openaiBaseUrl: appConfig.openai.baseUrl,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  },
): { provider: ModelProviderName; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable({
    provider,
    openaiApiKey: credentials.openaiApiKey,
    openaiBaseUrl: credentials.openaiBaseUrl,
    anthropicApiKey: credentials.anthropicApiKey,
    googleApiKey: credentials.googleApiKey,
  });
  return { provider, available };
}

export function resolveRunnableModel(
  role: AgentRole,
  requestedModel: string,
  options: {
    overrides?: {
      planner?: string;
      coder?: string;
      reviewer?: string;
    };
    credentials?: {
      openaiApiKey?: string;
      openaiBaseUrl: string;
      anthropicApiKey?: string;
      googleApiKey?: string;
    };
  } = {},
): {
  model: string;
  provider: ModelProviderName;
  available: boolean;
  usedFallback: boolean;
} {
  const preferredModel = resolveAgentModel(role, requestedModel, options.overrides);
  const preferredState = resolveModelProviderState(preferredModel, options.credentials);
  if (preferredState.available || preferredModel === requestedModel) {
    return {
      model: preferredModel,
      provider: preferredState.provider,
      available: preferredState.available,
      usedFallback: false,
    };
  }

  const requestedState = resolveModelProviderState(requestedModel, options.credentials);
  if (requestedState.available) {
    return {
      model: requestedModel,
      provider: requestedState.provider,
      available: true,
      usedFallback: true,
    };
  }

  return {
    model: preferredModel,
    provider: preferredState.provider,
    available: false,
    usedFallback: false,
  };
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

    const numbered = trimmedRight.match(/^\s*(\d+)[).]?\s+(.*)$/);
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

function isDogfoodPrompt(text: string): boolean {
  return text.includes("Dogfood mode:");
}

function normalizeDogfoodOutput(output: string): string {
  const cleaned = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(Outcome|Validation plan|Risk)\s*[-:]/i.test(line))
    .filter((line) => !/^I can\b/i.test(line))
    .filter((line) => !/^(quick (status|summary|recap|context|options|reminders?)|repo context)\b/i.test(line))
    .filter((line) => !/^pick one\b/i.test(line))
    .filter((line) => !/^which option\b/i.test(line))
    .filter((line) => !/^reply\s+[a-z0-9]/i.test(line))
    .filter((line) => !/^[A-C]\s*[-—:)]\s+/i.test(line));

  const immediate =
    cleaned.find((line) => /^Immediate action\s*[-:]/i.test(line)) ??
    cleaned.find((line) => /^\d+\.\s+/.test(line)) ??
    cleaned.find((line) => /^[-*]\s+/.test(line)) ??
    cleaned[0];

  if (!immediate) {
    return "Immediate action: Confirm the target change and I will apply the smallest safe edit + verify.";
  }

  const body = immediate
    .replace(/^Immediate action\s*[-:]\s*/i, "")
    .replace(/^Immediate action\s*[—-]\s*/i, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^I (will|can)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = body.length > 220 ? `${body.slice(0, 219).trimEnd()}…` : body;
  return `Immediate action: ${compact}`;
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
  if (isDogfoodPrompt(message)) {
    return normalizeDogfoodOutput(output);
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
  const hasAuxScaffolding =
    /^(quick (status|summary|recap|context|options|reminders?)|repo context|pick one action|notes?\s*\/?\s*blockers?|next-action options?|next actions?|next steps?)\b/im.test(
      normalizedOptions,
    );

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
      if (/^recap\s*[:-]/i.test(trimmed)) {
        return false;
      }
      if (hasAuxScaffolding && /^ready(?:[,.!]|$|\s*[—-]\s*)/i.test(trimmed)) {
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
    return compactAssistantOutput(cleaned);
  }
  return "No output produced. Try rephrasing your prompt.";
}

function buildMockReply(req: ChatRequest, reason?: string): ChatResponse {
  return {
    model: req.model,
    output: [
      "Remote backend is active.",
      reason ?? "Provider credentials are unavailable for the requested model, so mock mode is enabled.",
      `Plan: ${FALLBACK_PLAN}`,
      `Echo: ${req.message.trim()}`,
    ].join(" "),
  };
}

export async function runAgent(input: { request: ChatRequest; soulPrompt: string }): Promise<ChatResponse> {
  const role = selectAgentRole(input.request.message);
  const roleSoul = loadRoleSoulPrompt(role);
  const resolved = resolveRunnableModel(role, input.request.model);
  if (!resolved.available) {
    return buildMockReply(input.request, `Provider '${resolved.provider}' is not configured.`);
  }
  const model = resolved.model;

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
  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions = input.request.sessionId ? { thread: input.request.sessionId, resource: resourceId } : undefined;
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
