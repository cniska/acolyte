import type { ChatMessage, ChatRow, MessageId } from "./chat-contract";
import { nowIso } from "./datetime";
import { remapDomainId } from "./id-contract";
import { createId } from "./short-id";

export function createMessageId(): MessageId {
  return `msg_${createId()}`;
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
