import type { ChatRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import type { Session, SessionStore } from "./types";

function row(role: ChatRow["role"], content: string): ChatRow {
  return { id: `row_${crypto.randomUUID()}`, role, content };
}

export function createResumePicker(store: SessionStore, limit = 20): PickerState | null {
  const items = store.sessions.slice(0, limit);
  if (items.length === 0) {
    return null;
  }
  const activeIndex = items.findIndex((item) => item.id === store.activeSessionId);
  return { kind: "resume", items, index: activeIndex >= 0 ? activeIndex : 0 };
}

export function createResumeRows(session: Session, toRows: (messages: Session["messages"]) => ChatRow[]): ChatRow[] {
  return [...toRows(session.messages), row("assistant", `Resumed session: ${session.id.slice(0, 12)}`)];
}

export function boundedSkillInstructions(instructions: string, maxChars: number): string {
  if (instructions.length <= maxChars) {
    return instructions;
  }
  return `${instructions.slice(0, maxChars - 1)}…`;
}
