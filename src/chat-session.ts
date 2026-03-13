import type { ChatRow } from "./chat-contract";
import type { Message } from "./chat-message-contract";
import { nowIso } from "./datetime";
import { createId } from "./short-id";

export function createMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${createId()}`,
    role,
    content,
    kind: "text",
    timestamp: nowIso(),
  };
}

export function toRows(messages: Message[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      rows.push({
        id: `row_${createId()}`,
        role: message.role,
        content: message.content,
      });
    }
  }
  return rows;
}
