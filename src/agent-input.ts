import { encoding_for_model } from "tiktoken";
import type { ChatRequest } from "./api";

type TokenEncoder = { encode(input: string): { length: number } };

const defaultEncoder: TokenEncoder = encoding_for_model("gpt-4o");
let activeEncoder: TokenEncoder = defaultEncoder;

/** Replace the tokenizer (test-only). */
export function setTokenEncoder(encoder: TokenEncoder | null): void {
  activeEncoder = encoder ?? defaultEncoder;
}

export function estimateTokens(input: string): number {
  if (input.length === 0) return 0;
  return activeEncoder.encode(input).length;
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(input) <= maxTokens) return input;
  // Binary search for the longest prefix that fits within the token budget.
  let lo = 0;
  let hi = input.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (estimateTokens(input.slice(0, mid)) <= maxTokens - 1) lo = mid;
    else hi = mid - 1;
  }
  return `${input.slice(0, lo)}…`;
}

function isRelevantFileContext(content: string): boolean {
  return content.startsWith("Attached file:") || content.startsWith("Attached directory:");
}

function isSkillContext(content: string): boolean {
  return content.startsWith("Active skill (");
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
  maxHistoryMessages: number,
): { lines: string[]; consumedTokens: number } {
  const lines: string[] = [];
  let consumed = 0;
  const recent = messages.slice(-maxHistoryMessages);
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
  if (ageFromLatest <= 4) return Math.min(maxPerMessageTokens, 500);
  if (ageFromLatest <= 10) return Math.min(maxPerMessageTokens, 300);
  return Math.min(maxPerMessageTokens, 200);
}

export type InputBudget = {
  maxHistoryMessages: number;
  maxMessageTokens: number;
  maxAttachmentMessageTokens: number;
  maxSkillContextTokens: number;
};

export function createAgentInput(
  req: ChatRequest,
  options: { systemPromptTokens?: number; toolTokens?: number; contextMaxTokens: number; budget: InputBudget },
): {
  input: string;
  usage: {
    inputTokens: number;
    inputBudgetTokens: number;
    systemPromptTokens: number;
    toolTokens: number;
    memoryTokens: number;
    messageTokens: number;
    inputTruncated: boolean;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
    activeSkillName?: string;
    skillInstructionChars?: number;
  };
} {
  const contextMaxTokens = options.contextMaxTokens;
  const systemPromptTokens = options.systemPromptTokens ?? 0;
  const toolTokens = options.toolTokens ?? 0;
  const lines: string[] = [];
  const usedIds = new Set<string>();
  const budget = options.budget;

  const userLine = `USER: ${truncateByTokens(req.message.trim(), budget.maxMessageTokens)}`;
  const userTokens = estimateTokens(userLine);
  let remaining = Math.max(0, contextMaxTokens - userTokens - systemPromptTokens - toolTokens);

  const skillMessages = req.history.filter((message) => message.role === "system" && isSkillContext(message.content));
  const skillResult = collectLinesWithinBudget(
    skillMessages,
    usedIds,
    remaining,
    budget.maxSkillContextTokens,
    budget.maxHistoryMessages,
  );
  lines.push(...skillResult.lines);
  remaining -= skillResult.consumedTokens;

  const relevantFiles = req.history.filter(
    (message) => message.role === "system" && isRelevantFileContext(message.content),
  );
  const filesResult = collectLinesWithinBudget(
    relevantFiles,
    usedIds,
    remaining,
    budget.maxAttachmentMessageTokens,
    budget.maxHistoryMessages,
  );
  lines.push(...filesResult.lines);
  remaining -= filesResult.consumedTokens;

  const recentResult = collectLinesWithinBudget(
    req.history,
    usedIds,
    remaining,
    budget.maxMessageTokens,
    budget.maxHistoryMessages,
  );
  lines.push(...recentResult.lines);

  if (lines.length > 0) lines.push("");
  lines.push(userLine);
  const input = lines.join("\n");
  const inputTokens = estimateTokens(input);

  let activeSkillName: string | undefined;
  let skillInstructionChars: number | undefined;
  for (const msg of skillMessages) {
    const match = msg.content.match(/^Active skill \(([^)]+)\):/);
    if (match) {
      activeSkillName = match[1];
      skillInstructionChars = msg.content.length;
      break;
    }
  }

  // inputTokens covers only the composed input (history + user message); it
  // excludes system prompt tokens, which are accounted for separately via
  // options.systemPromptTokens and returned as usage.systemPromptTokens.
  return {
    input,
    usage: {
      inputTokens,
      inputBudgetTokens: contextMaxTokens,
      systemPromptTokens,
      toolTokens: 0,
      memoryTokens: 0,
      messageTokens: inputTokens,
      inputTruncated: usedIds.size < req.history.length,
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
      activeSkillName,
      skillInstructionChars,
    },
  };
}
