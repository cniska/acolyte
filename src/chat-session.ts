import type { ChatRow } from "./chat-commands";
import type { Message } from "./chat-message";
import { nowIso } from "./datetime";
import { createId } from "./short-id";

const RESUME_TRANSCRIPT_ROWS = 40;

export function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${createId()}`,
    role,
    content,
    kind: "text",
    timestamp: nowIso(),
  };
}

export function toRows(messages: Message[], limit = RESUME_TRANSCRIPT_ROWS): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      rows.push({
        id: message.id,
        role: message.role,
        content: message.content,
      });
    }
  }
  return rows.slice(-limit);
}
