import type { TokenUsage } from "./api";
import type { Backend } from "./backend";
import type { ChatRow, TokenUsageEntry } from "./chat-commands";
import { extractAtReferencePaths } from "./chat-file-ref";
import { formatThoughtDuration, formatVerifySummary } from "./chat-formatters";
import { runShellCommand } from "./coding-tools";
import { buildFileContext } from "./file-context";
import type { Message, Session } from "./types";

function row(role: ChatRow["role"], content: string, dim = false): ChatRow {
  return { id: `row_${crypto.randomUUID()}`, role, content, dim };
}

const TOOL_LABELS: Record<string, string> = {
  "run-command": "Run",
  "read-file": "Read",
  "search-repo": "Search",
  "git-status": "Status",
  "git-diff": "Diff",
  "edit-file": "Edit",
  "web-search": "Web Search",
  "web-fetch": "Web Fetch",
};

export function formatToolLabel(toolId: string): string {
  const known = TOOL_LABELS[toolId];
  if (known) {
    return known;
  }
  return toolId
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

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
  return unresolvedPaths.map((pathInput) => row("system", `No file or folder found: @${pathInput}`));
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
  backend: Backend;
  userText: string;
  history: Message[];
  model: string;
  sessionId: string;
  signal?: AbortSignal;
  runVerifyAfterReply: boolean;
  thinkingStartedAt: number;
  createMessage: (role: Message["role"], content: string) => Message;
};

export async function runAssistantTurn(params: RunAssistantTurnParams): Promise<{
  assistantMessage: Message;
  tokenEntry: TokenUsageEntry;
  rows: ChatRow[];
  model: string;
}> {
  const reply = await params.backend.reply(
    {
      message: params.userText,
      history: params.history,
      model: params.model,
      sessionId: params.sessionId,
    },
    { signal: params.signal },
  );

  const assistantMessage = params.createMessage("assistant", reply.output);
  const rows: ChatRow[] = [];
  for (const toolId of reply.toolCalls ?? []) {
    rows.push(row("system", `Tool: ${formatToolLabel(toolId)}`, true));
  }
  rows.push(row("assistant", reply.output));
  const tokenEntry: TokenUsageEntry = {
    id: assistantMessage.id,
    usage: reply.usage ?? estimateTokenUsageFallback(params.userText, reply.output),
    warning: reply.budgetWarning,
  };

  if (params.runVerifyAfterReply) {
    rows.push(row("system", "  verifying…", true));
    try {
      const verifyResult = await runShellCommand("bun run verify");
      rows.push(row("assistant", formatVerifySummary(verifyResult)));
    } catch (error) {
      rows.push(row("system", error instanceof Error ? error.message : "Verify step failed."));
    }
  }

  const durationMs = Date.now() - params.thinkingStartedAt;
  if (durationMs >= 300) {
    rows.push(row("assistant", `thought for ${formatThoughtDuration(durationMs)}`, true));
  }

  return {
    assistantMessage,
    tokenEntry,
    rows,
    model: reply.model,
  };
}
