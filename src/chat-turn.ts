import { createWorkspaceSpecifier, type TokenUsage } from "./api";
import type { ChatMessage } from "./chat-contract";
import { type ChatRow, createRow } from "./chat-contract";
import { extractAtReferencePaths } from "./chat-file-ref";
import { formatTokenCount } from "./chat-format";
import type { Client, StreamEvent } from "./client-contract";
import { formatDuration } from "./datetime";
import { formatFileContext } from "./file-context";
import { t } from "./i18n";
import { palette } from "./palette";
import type { Session, SessionTokenUsageEntry } from "./session-contract";
import { createId } from "./short-id";
import type { ActiveSkill } from "./skill-contract";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

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

export async function resolveReferencedFileContext(
  userText: string,
  options?: { workspace?: string },
): Promise<{
  contexts: string[];
  unresolvedPaths: string[];
}> {
  const referencedPaths = extractAtReferencePaths(userText);
  const contexts: string[] = [];
  const unresolvedPaths: string[] = [];
  const workspace = options?.workspace ?? process.cwd();
  for (const pathInput of referencedPaths) {
    try {
      ensurePathWithinSandbox(pathInput, workspace);
      const context = await formatFileContext(pathInput, workspace);
      contexts.push(context);
    } catch {
      unresolvedPaths.push(pathInput);
    }
  }
  return { contexts, unresolvedPaths };
}

export function unresolvedPathRows(unresolvedPaths: string[]): ChatRow[] {
  return unresolvedPaths.map((pathInput) => createRow("system", t("chat.unresolved_path", { path: pathInput })));
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

export function applyUserTurn(params: ApplyUserTurnParams): { row: ChatRow } {
  if (params.session.title === t("chat.session.default_title"))
    params.session.title =
      params.displayText.trim().replace(/\s+/g, " ").slice(0, 60) || t("chat.session.default_title");
  return { row: { id: `row_${createId()}`, kind: "user", content: params.displayText } };
}

type RunAssistantTurnParams = {
  client: Client;
  userText: string;
  history: ChatMessage[];
  model: string;
  sessionId: string;
  activeSkills?: ActiveSkill[];
  suggestions?: string[];
  workspace?: string;
  useMemory?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
  pendingStartedAt: number;
  createMessage: (role: ChatMessage["role"], content: string) => ChatMessage;
};

export async function runAssistantTurn(params: RunAssistantTurnParams): Promise<{
  assistantMessage: ChatMessage;
  tokenEntry: SessionTokenUsageEntry;
  rows: ChatRow[];
}> {
  const reply = await params.client.replyStream({
    request: {
      message: params.userText,
      history: params.history,
      model: params.model,
      sessionId: params.sessionId,
      activeSkills: params.activeSkills,
      suggestions: params.suggestions,
      useMemory: params.useMemory,
      ...createWorkspaceSpecifier(params.workspace ?? process.cwd()),
    },
    signal: params.signal,
    onEvent: params.onEvent ?? (() => {}),
  });

  const baseAssistantMessage = params.createMessage("assistant", reply.output);
  const assistantMessage: ChatMessage =
    (reply.toolCalls?.length ?? 0) > 0 ? { ...baseAssistantMessage, kind: "tool_payload" } : baseAssistantMessage;
  const rows: ChatRow[] = [];
  if (reply.error) {
    rows.push(createRow("system", reply.error, { text: palette.error }));
  }
  const tokenEntry: SessionTokenUsageEntry = {
    id: assistantMessage.id,
    usage: reply.usage ?? estimateTokenUsageFallback(params.userText, reply.output),
    promptBreakdown: reply.promptBreakdown,

    modelCalls: reply.modelCalls,
  };
  if (reply.state === "awaiting-input") {
    rows.push(createRow("status", t("chat.awaiting_input"), { marker: palette.brand, dim: true }));
  } else {
    const durationMs = Date.now() - params.pendingStartedAt;
    if (durationMs >= 300) {
      const duration = formatDuration(durationMs);
      const toolCount = reply.toolCalls?.length ?? 0;
      const totalTokens = tokenEntry.usage.totalTokens;
      const details: string[] = [];
      if (toolCount > 0) details.push(t("unit.tool", { count: toolCount }));
      if (totalTokens > 0) details.push(formatTokenCount(totalTokens));
      const suffix = details.length > 0 ? ` (${details.join(" · ")})` : "";
      rows.push(createRow("status", t("chat.worked", { duration, suffix }), { marker: palette.success, dim: true }));
    }
  }

  return {
    assistantMessage,
    tokenEntry,
    rows,
  };
}
