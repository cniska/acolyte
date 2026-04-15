import type { ChatMessage } from "./chat-contract";

type SearchableMessage = Pick<ChatMessage, "id" | "role" | "content" | "kind" | "timestamp">;

export function searchMessages(
  messages: readonly SearchableMessage[],
  query: string,
  options?: { limit?: number },
): SearchableMessage[] {
  const limit = options?.limit ?? 10;
  const lower = query.toLowerCase();
  const results: SearchableMessage[] = [];
  for (const m of messages) {
    if (m.kind === "status") continue;
    if (!m.content.toLowerCase().includes(lower)) continue;
    results.push(m);
    if (results.length >= limit) break;
  }
  return results;
}
