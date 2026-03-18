import type { ChatRow } from "./chat-contract";
import type { HeaderLine } from "./chat-header";

export type HeaderItem = { id: string; kind: "header"; lines: HeaderLine[] };
export type PromotedItem = ChatRow | HeaderItem;

export function appendPromotedItems(current: PromotedItem[], next: readonly PromotedItem[]): PromotedItem[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const appended: PromotedItem[] = [];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    appended.push(item);
  }
  return appended.length > 0 ? [...current, ...appended] : current;
}

export function applyPromotion(
  promoted: PromotedItem[],
  toPromote: ChatRow[],
  live: ChatRow[],
): { nextPromoted: PromotedItem[]; nextLive: ChatRow[] } {
  const promotedIds = new Set(toPromote.map((row) => row.id));
  return {
    nextPromoted: appendPromotedItems(promoted, toPromote),
    nextLive: live.filter((row) => !promotedIds.has(row.id)),
  };
}

export function isHeaderItem(item: PromotedItem): item is HeaderItem {
  return "kind" in item && item.kind === "header";
}

export function createHeaderItem(version: string, sessionId: string): HeaderItem {
  return {
    id: `header_${sessionId}`,
    kind: "header",
    lines: [
      { id: "title", text: "Acolyte" },
      { id: "session", text: `version ${version}` },
      { id: "context", text: `session ${sessionId}` },
    ],
  };
}
