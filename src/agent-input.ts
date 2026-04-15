import type { ChatRequest } from "./api";
import { log } from "./log";

export const HISTORY_WINDOW = 5;

type TokenEncoder = { encode(input: string): { length: number } };

function createApproxEncoder(): TokenEncoder {
  return {
    encode(input) {
      // We use token estimates for budgeting and truncation. Exact accuracy is
      // not required for commands that don't run the lifecycle. The lifecycle
      // switches this to the real tokenizer via ensureRealTokenEncoder().
      return { length: Math.ceil(input.length / 4) };
    },
  };
}

let defaultEncoder: TokenEncoder = createApproxEncoder();
let activeEncoder: TokenEncoder = defaultEncoder;
let tiktokenReady = false;
let tiktokenInitPromise: Promise<void> | null = null;

export async function ensureRealTokenEncoder(): Promise<void> {
  if (tiktokenReady) return;
  if (tiktokenInitPromise) return tiktokenInitPromise;

  const prevDefault = defaultEncoder;
  tiktokenInitPromise = (async () => {
    const { ensureTiktokenInitialized } = await import("./tiktoken-runtime");
    const { encoding_for_model } = await import("tiktoken/init");
    await ensureTiktokenInitialized();
    defaultEncoder = encoding_for_model("gpt-4o");
    if (activeEncoder === prevDefault) activeEncoder = defaultEncoder;
    tiktokenReady = true;
  })();

  return tiktokenInitPromise;
}

/** Replace the tokenizer (test-only). */
export function setTokenEncoder(encoder: TokenEncoder | null): void {
  activeEncoder = encoder ?? defaultEncoder;
}

export function estimateTokens(input: string): number {
  if (input.length === 0) return 0;
  return activeEncoder.encode(input).length;
}

type PromptTokenBudget = {
  consume: (tokens: number) => void;
  remaining: () => number;
};

function createPromptTokenBudget(total: number): PromptTokenBudget {
  let remaining = Math.max(0, Math.floor(total));

  const clampRequest = (tokens: number): number => Math.max(0, Math.floor(tokens));

  const consume = (tokens: number): void => {
    const requested = clampRequest(tokens);
    if (requested === 0 || remaining === 0) return;
    remaining = Math.max(0, remaining - requested);
  };

  return {
    consume,
    remaining: () => remaining,
  };
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

function isConversationalMessage(message: ChatRequest["history"][number]): boolean {
  if (message.role === "system") return false;
  if (message.kind === "status") return false;
  return true;
}

function lastNTurns(messages: ChatRequest["history"], n: number): ChatRequest["history"] {
  const conversational = messages.filter(isConversationalMessage);
  let turns = 0;
  let cutIndex = 0;
  for (let i = conversational.length - 1; i >= 0; i--) {
    if (conversational[i].role === "user") {
      turns++;
      if (turns > n) return conversational.slice(cutIndex);
      cutIndex = i;
    }
  }
  return conversational;
}

function isAssistantToolPayloadMessage(message: ChatRequest["history"][number]): boolean {
  return message.role === "assistant" && message.kind === "tool_payload";
}

function lineForMessage(message: ChatRequest["history"][number], maxTokens: number): { line: string; tokens: number } {
  const compact = truncateByTokens(message.content, maxTokens);
  const line = `${message.role.toUpperCase()}: ${compact}`;
  return { line, tokens: estimateTokens(line) };
}

function lineForMessageWithinBudget(
  message: ChatRequest["history"][number],
  remainingTokens: number,
): { line: string; tokens: number } | null {
  if (remainingTokens <= 0) return null;
  let tokenLimit = remainingTokens;
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
): { lines: string[]; consumedTokens: number } {
  const lines: string[] = [];
  let consumed = 0;
  const includeMessage = (i: number): void => {
    const message = messages[i];
    if (usedIds.has(message.id)) return;
    const candidate = lineForMessageWithinBudget(message, remainingTokens - consumed);
    if (!candidate || candidate.tokens === 0) return;
    usedIds.add(message.id);
    lines.unshift(candidate.line);
    consumed += candidate.tokens;
  };

  // Prefer conversational turns first and only then spend remaining budget on tool payloads.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isAssistantToolPayloadMessage(messages[i])) continue;
    includeMessage(i);
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isAssistantToolPayloadMessage(messages[i])) continue;
    includeMessage(i);
  }
  return { lines, consumedTokens: consumed };
}

export function createAgentInput(
  req: ChatRequest,
  options: { systemPromptTokens?: number; toolTokens?: number; contextMaxTokens: number },
): {
  input: string;
  usage: {
    inputTokens: number;
    inputBudgetTokens: number;
    systemPromptTokens: number;
    toolTokens: number;
    skillTokens: number;
    memoryTokens: number;
    messageTokens: number;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
  };
} {
  const contextMaxTokens = options.contextMaxTokens;
  const requestedSystemTokens = options.systemPromptTokens ?? 0;
  const requestedToolTokens = options.toolTokens ?? 0;
  const lines: string[] = [];
  const usedIds = new Set<string>();
  let includedSkillTokens = 0;
  const tokenBudget = createPromptTokenBudget(contextMaxTokens);
  tokenBudget.consume(requestedSystemTokens);
  tokenBudget.consume(requestedToolTokens);

  const userLine = `USER: ${req.message.trim()}`;
  const userTokens = estimateTokens(userLine);
  tokenBudget.consume(userTokens);

  for (const skill of req.activeSkills ?? []) {
    const skillLine = `SYSTEM: Active skill (${skill.name}):\n${skill.instructions}`;
    const skillTokens = estimateTokens(skillLine);
    if (skillTokens > tokenBudget.remaining()) {
      log.warn("skill context dropped", { skill: skill.name, tokens: skillTokens, remaining: tokenBudget.remaining() });
    } else {
      lines.push(skillLine);
      tokenBudget.consume(skillTokens);
      includedSkillTokens += skillTokens;
    }
  }

  for (const suggestion of req.suggestions ?? []) {
    const suggestionTokens = estimateTokens(suggestion);
    if (suggestionTokens > tokenBudget.remaining()) {
      log.warn("suggestion dropped", { tokens: suggestionTokens, remaining: tokenBudget.remaining() });
    } else {
      lines.push(suggestion);
      tokenBudget.consume(suggestionTokens);
    }
  }

  const recentHistory = lastNTurns(req.history, HISTORY_WINDOW);
  const recentResult = collectLinesWithinBudget(recentHistory, usedIds, tokenBudget.remaining());
  lines.push(...recentResult.lines);

  if (lines.length > 0) lines.push("");
  lines.push(userLine);
  const input = lines.join("\n");
  const inputTokens = estimateTokens(input);

  // inputTokens covers only the composed input (history + user message); it
  // excludes system prompt tokens, which are accounted for separately via
  // options.systemPromptTokens and returned as usage.systemPromptTokens.
  return {
    input,
    usage: {
      inputTokens,
      inputBudgetTokens: contextMaxTokens,
      systemPromptTokens: requestedSystemTokens,
      toolTokens: requestedToolTokens,
      skillTokens: includedSkillTokens,
      memoryTokens: 0,
      messageTokens: Math.max(0, inputTokens - includedSkillTokens),
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
    },
  };
}
