import type { AgentMode } from "./agent-contract";
import { createWorkspaceSpecifier, type TokenUsage } from "./api";
import type { ChatMessage } from "./chat-contract";
import { type ChatLine, createLine } from "./chat-contract";
import { extractAtReferencePaths } from "./chat-file-ref";
import { formatThoughtDuration, formatTokenCount } from "./chat-format";
import type { Client, StreamEvent } from "./client-contract";
import { formatFileContext } from "./file-context";
import { t } from "./i18n";
import { palette } from "./palette";
import type { Session, SessionTokenUsageEntry } from "./session-contract";
import { createId } from "./short-id";

const AVERAGE_CHARS_PER_TOKEN = 4;

export function estimateTokenUsageFallback(prompt: string, output: string): TokenUsage {
  const inputTokens = Math.ceil(prompt.length / AVERAGE_CHARS_PER_TOKEN);
  const outputTokens = Math.ceil(output.length / AVERAGE_CHARS_PER_TOKEN);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
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
      const context = await formatFileContext(pathInput);
      contexts.push(context);
    } catch {
      unresolvedPaths.push(pathInput);
    }
  }
  return { contexts, unresolvedPaths };
}

export function unresolvedPathRows(unresolvedPaths: string[]): ChatLine[] {
  return unresolvedPaths.map((pathInput) => createLine("system", t("chat.unresolved_path", { path: pathInput })));
}

export function appendInputHistory(history: string[], value: string, maxEntries = 200): string[] {
  if (history[history.length - 1] === value) return history;
  const next = [...history, value];
  if (next.length > maxEntries) return next.slice(next.length - maxEntries);
  return next;
}

export function createInputHistory(messages: ChatMessage[], maxEntries = 200): string[] {
  let history: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const value = message.content.trim();
    if (value.length === 0) continue;
    history = appendInputHistory(history, value, maxEntries);
  }
  return history;
}

type ApplyUserTurnParams = {
  session: Session;
  displayText: string;
};

export function applyUserTurn(params: ApplyUserTurnParams): { row: ChatLine } {
  if (params.session.title === t("chat.session.default_title"))
    params.session.title =
      params.displayText.trim().replace(/\s+/g, " ").slice(0, 60) || t("chat.session.default_title");
  return { row: { id: `row_${createId()}`, role: "user", content: params.displayText } };
}

type RunAssistantTurnParams = {
  client: Client;
  userText: string;
  history: ChatMessage[];
  model: string;
  modeModels?: Partial<Record<AgentMode, string>>;
  sessionId: string;
  useMemory?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
  thinkingStartedAt: number;
  createMessage: (role: ChatMessage["role"], content: string) => ChatMessage;
};

export async function runAssistantTurn(params: RunAssistantTurnParams): Promise<{
  assistantMessage: ChatMessage;
  tokenEntry: SessionTokenUsageEntry;
  rows: ChatLine[];
}> {
  const reply = await params.client.replyStream(
    {
      message: params.userText,
      history: params.history,
      model: params.model,
      modeModels: params.modeModels,
      sessionId: params.sessionId,
      useMemory: params.useMemory,
      ...createWorkspaceSpecifier(),
    },
    { signal: params.signal, onEvent: params.onEvent ?? (() => {}) },
  );

  const baseAssistantMessage = params.createMessage("assistant", reply.output);
  const assistantMessage: ChatMessage =
    (reply.toolCalls?.length ?? 0) > 0 ? { ...baseAssistantMessage, kind: "tool_payload" } : baseAssistantMessage;
  const rows: ChatLine[] = [];
  if (reply.error) {
    rows.push(createLine("system", reply.error, { text: palette.error }));
  } else if (reply.output.trim().length > 0) {
    rows.push(createLine("assistant", reply.output));
  }
  const tokenEntry: SessionTokenUsageEntry = {
    id: assistantMessage.id,
    usage: reply.usage ?? estimateTokenUsageFallback(params.userText, reply.output),
    promptBreakdown: reply.promptBreakdown,

    modelCalls: reply.modelCalls,
  };
  const durationMs = Date.now() - params.thinkingStartedAt;
  if (durationMs >= 300) {
    const duration = formatThoughtDuration(durationMs);
    const toolCount = reply.toolCalls?.length ?? 0;
    const totalTokens = tokenEntry.usage.totalTokens;
    const details: string[] = [];
    if (toolCount > 0) details.push(t("unit.tool", { count: toolCount }));
    if (totalTokens > 0) details.push(formatTokenCount(totalTokens));
    const suffix = details.length > 0 ? ` (${details.join(" · ")})` : "";
    rows.push(createLine("status", t("chat.worked", { duration, suffix }), { marker: palette.success, dim: true }));
  }

  return {
    assistantMessage,
    tokenEntry,
    rows,
  };
}
