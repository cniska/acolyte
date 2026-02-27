import type { TokenUsage } from "./api";
import { type ChatRow, createRow, type TokenUsageEntry } from "./chat-commands";
import { extractAtReferencePaths } from "./chat-file-ref";
import { formatThoughtDuration } from "./chat-formatters";
import type { Client, StreamEvent } from "./client";
import { buildFileContext } from "./file-context";
import type { Message, Session } from "./types";

export function estimateTokenUsageFallback(prompt: string, output: string): TokenUsage {
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export async function resolveReferencedFileContext(userText: string): Promise<{
  contexts: string[];
  unresolvedPaths: string[];
}> {
  const referencedPaths = extractAtReferencePaths(userText);
  const contexts: string[] = [];
  const unresolvedPaths: string[] = [];
  for (const pathInput of referencedPaths) {
    try {
      const context = await buildFileContext(pathInput);
      contexts.push(context);
    } catch {
      unresolvedPaths.push(pathInput);
    }
  }
  return { contexts, unresolvedPaths };
}

export function unresolvedPathRows(unresolvedPaths: string[]): ChatRow[] {
  return unresolvedPaths.map((pathInput) => createRow("system", `No file or folder found: @${pathInput}`));
}

export function appendInputHistory(history: string[], value: string, maxEntries = 200): string[] {
  if (history[history.length - 1] === value) {
    return history;
  }
  const next = [...history, value];
  if (next.length > maxEntries) {
    return next.slice(next.length - maxEntries);
  }
  return next;
}

export function buildInputHistory(messages: Message[], maxEntries = 200): string[] {
  let history: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const value = message.content.trim();
    if (value.length === 0) {
      continue;
    }
    history = appendInputHistory(history, value, maxEntries);
  }
  return history;
}

type ApplyUserTurnParams = {
  session: Session;
  displayText: string;
  userText: string;
  nowIso: () => string;
  createMessage: (role: Message["role"], content: string) => Message;
};

export function applyUserTurn(params: ApplyUserTurnParams): { userMessage: Message; row: ChatRow } {
  const userMessage = params.createMessage("user", params.userText);
  params.session.messages.push(userMessage);
  if (params.session.title === "New Session") {
    params.session.title = params.displayText.trim().replace(/\s+/g, " ").slice(0, 60) || "New Session";
  }
  params.session.updatedAt = params.nowIso();
  return { userMessage, row: { id: userMessage.id, role: "user", content: params.displayText } };
}

type RunAssistantTurnParams = {
  client: Client;
  userText: string;
  history: Message[];
  model: string;
  sessionId: string;
  useMemory?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
  thinkingStartedAt: number;
  createMessage: (role: Message["role"], content: string) => Message;
};

export async function runAssistantTurn(params: RunAssistantTurnParams): Promise<{
  assistantMessage: Message;
  tokenEntry: TokenUsageEntry;
  rows: ChatRow[];
}> {
  const reply = params.onEvent
    ? await params.client.replyStream(
        {
          message: params.userText,
          history: params.history,
          model: params.model,
          sessionId: params.sessionId,
          useMemory: params.useMemory,
          workspace: process.cwd(),
        },
        { signal: params.signal, onEvent: params.onEvent },
      )
    : await params.client.reply(
        {
          message: params.userText,
          history: params.history,
          model: params.model,
          sessionId: params.sessionId,
          useMemory: params.useMemory,
          workspace: process.cwd(),
        },
        { signal: params.signal },
      );

  const assistantMessage = params.createMessage("assistant", reply.output);
  const rows: ChatRow[] = [];
  if (reply.output.trim().length > 0) {
    rows.push(createRow("assistant", reply.output));
  }
  const tokenEntry: TokenUsageEntry = {
    id: assistantMessage.id,
    usage: reply.usage ?? estimateTokenUsageFallback(params.userText, reply.output),
    warning: reply.budgetWarning,
    modelCalls: reply.modelCalls,
  };

  const durationMs = Date.now() - params.thinkingStartedAt;
  if (durationMs >= 300) {
    const duration = formatThoughtDuration(durationMs);
    const toolCount = reply.toolCalls?.length ?? 0;
    const modelCount = reply.modelCalls ?? 0;
    const details: string[] = [];
    if (toolCount > 0) details.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
    if (modelCount > 1) details.push(`${modelCount} model calls`);
    const suffix = details.length > 0 ? ` (${details.join(" · ")})` : "";
    rows.push(createRow("assistant", `Worked ${duration}${suffix}`, { dim: true }));
  }

  return {
    assistantMessage,
    tokenEntry,
    rows,
  };
}
