import type { ChatEntry, ChatMessage } from "./chat-contract";
import { nowIso } from "./datetime";
import { remapDomainId } from "./id-contract";
import { createId } from "./short-id";

export function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `msg_${createId()}`,
    role,
    content,
    kind: "text",
    timestamp: nowIso(),
  };
}

export function toRows(messages: ChatMessage[]): ChatEntry[] {
  const rows: ChatEntry[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      rows.push({
        id: remapDomainId(message.id, "row"),
        kind: message.role,
        content: message.content,
      });
    }
  }
  return rows;
}
