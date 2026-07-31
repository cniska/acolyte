import type { ChatMessage, ChatRow, MessageId } from "./chat-contract";
import { nowIso } from "./datetime";
import { remapDomainId } from "./id-contract";
import type { PromptBreakdown, SessionTokenUsageEntry, TokenUsage } from "./session-contract";
import { createId } from "./short-id";

export function createMessageId(): MessageId {
  return `msg_${createId()}`;
}

export function createTokenUsageEntry(params: {
  usage: Omit<TokenUsage, "totalTokens"> & { totalTokens?: number };
  /**
   * The message this usage is attributed to. Omitted when the turn ended before producing one:
   * nothing resolves an entry id back to a message, so the entry owns its own identity.
   */
  id?: MessageId;
  promptBreakdown?: PromptBreakdown;
  modelCalls?: number;
}): SessionTokenUsageEntry {
  return {
    id: params.id ?? createMessageId(),
    usage: {
      ...params.usage,
      totalTokens: params.usage.totalTokens ?? params.usage.inputTokens + params.usage.outputTokens,
    },
    promptBreakdown: params.promptBreakdown,
    modelCalls: params.modelCalls,
  };
}

export function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    kind: "text",
    timestamp: nowIso(),
  };
}

export function toRows(messages: ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      rows.push({
        id: remapDomainId(message.id, "row"),
        kind: message.role,
        content: message.content,
      });
    } else if (message.kind === "status") {
      rows.push({
        id: remapDomainId(message.id, "row"),
        kind: "status",
        content: message.content,
        style: { outcome: "success", dim: true },
      });
    }
  }
  return rows;
}
