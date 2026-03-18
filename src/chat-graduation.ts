import type { ChatRow } from "./chat-contract";
import type { HeaderLine } from "./chat-header";

export type HeaderItem = { id: string; kind: "header"; lines: HeaderLine[] };
export type GraduatedItem = ChatRow | HeaderItem;

export function appendGraduatedItems(current: GraduatedItem[], next: readonly GraduatedItem[]): GraduatedItem[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const appended: GraduatedItem[] = [];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    appended.push(item);
  }
  return appended.length > 0 ? [...current, ...appended] : current;
}

export function applyGraduation(
  graduated: GraduatedItem[],
  toGraduate: ChatRow[],
  live: ChatRow[],
): { nextGraduated: GraduatedItem[]; nextLive: ChatRow[] } {
  const graduatedIds = new Set(toGraduate.map((row) => row.id));
  return {
    nextGraduated: appendGraduatedItems(graduated, toGraduate),
    nextLive: live.filter((row) => !graduatedIds.has(row.id)),
  };
}

export function isHeaderItem(item: GraduatedItem): item is HeaderItem {
  return "kind" in item && item.kind === "header";
}

export function createHeaderItem(version: string, sessionId: string): HeaderItem {
  return {
    id: `header_${sessionId}`,
    kind: "header",
    lines: [
      { id: "title", text: "Acolyte", suffix: "", dim: false, brand: true },
      { id: "session", text: `version ${version}`, dim: false, brand: false },
      { id: "context", text: `session ${sessionId}`, dim: true, brand: false },
    ],
  };
}
