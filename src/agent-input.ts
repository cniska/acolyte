import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";

const APPROX_CHARS_PER_TOKEN = 4;

export function estimateTokens(input: string): number {
  if (input.length === 0) return 0;
  return Math.ceil(input.length / APPROX_CHARS_PER_TOKEN);
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isRelevantFileContext(content: string): boolean {
  return content.startsWith("Attached file:") || content.startsWith("Attached directory:");
}

function isPinnedSystemContext(content: string): boolean {
  return content.startsWith("Active skill (") || content.startsWith("Pinned memory:");
}

function isToolPayloadMessage(message: ChatRequest["history"][number]): boolean {
  return message.kind === "tool_payload";
}

function isAssistantToolPayloadMessage(message: ChatRequest["history"][number]): boolean {
  return message.role === "assistant" && isToolPayloadMessage(message);
}

function lineForMessage(message: ChatRequest["history"][number], maxTokens: number): { line: string; tokens: number } {
  const compact = truncateByTokens(message.content, maxTokens);
  const line = `${message.role.toUpperCase()}: ${compact}`;
  return { line, tokens: estimateTokens(line) };
}

function lineForMessageWithinBudget(
  message: ChatRequest["history"][number],
  maxTokens: number,
  remainingTokens: number,
): { line: string; tokens: number } | null {
  if (remainingTokens <= 0) return null;
  let tokenLimit = Math.min(maxTokens, remainingTokens);
  while (tokenLimit > 0) {
    const candidate = lineForMessage(message, tokenLimit);
    if (candidate.tokens <= remainingTokens) return candidate;
    tokenLimit -= 1;
  }
  return null;
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
  const includeMessage = (i: number): void => {
    const message = recent[i];
    if (usedIds.has(message.id)) return;
    const ageFromLatest = recent.length - 1 - i;
    const maxTokens = resolveMessageTokenCap(message, ageFromLatest, maxPerMessageTokens);
    const candidate = lineForMessageWithinBudget(message, maxTokens, remainingTokens - consumed);
    if (!candidate || candidate.tokens === 0) return;
    usedIds.add(message.id);
    lines.unshift(candidate.line);
    consumed += candidate.tokens;
  };

  // Prefer conversational turns first and only then spend remaining budget on tool payloads.
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (isAssistantToolPayloadMessage(recent[i])) continue;
    includeMessage(i);
  }
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (!isAssistantToolPayloadMessage(recent[i])) continue;
    includeMessage(i);
  }
  return { lines, consumedTokens: consumed };
}

function resolveMessageTokenCap(
  message: ChatRequest["history"][number],
  ageFromLatest: number,
  maxPerMessageTokens: number,
): number {
  if (!isAssistantToolPayloadMessage(message)) return maxPerMessageTokens;
  if (ageFromLatest <= 1) return maxPerMessageTokens;
  if (ageFromLatest <= 4) return Math.min(maxPerMessageTokens, 200);
  if (ageFromLatest <= 10) return Math.min(maxPerMessageTokens, 120);
  return Math.min(maxPerMessageTokens, 60);
}

export function createAgentInput(req: ChatRequest): {
  input: string;
  usage: {
    promptTokens: number;
    promptBudgetTokens: number;
    promptTruncated: boolean;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
    activeSkillName?: string;
    skillInstructionChars?: number;
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

  if (lines.length > 0) lines.push("");
  lines.push(userLine);
  const input = lines.join("\n");
  const promptTokens = estimateTokens(input);

  let activeSkillName: string | undefined;
  let skillInstructionChars: number | undefined;
  for (const msg of pinnedSystem) {
    const match = msg.content.match(/^Active skill \(([^)]+)\):/);
    if (match) {
      activeSkillName = match[1];
      skillInstructionChars = msg.content.length;
      break;
    }
  }

  return {
    input,
    usage: {
      promptTokens,
      promptBudgetTokens: maxContextTokens,
      promptTruncated: usedIds.size < req.history.length,
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
      activeSkillName,
      skillInstructionChars,
    },
  };
}
