import { useCallback, useRef, useState } from "react";
import type { ChatRow } from "./chat-contract";
import type { HeaderLine } from "./chat-header";
import { toRows } from "./chat-session";
import { log } from "./log";
import type { Session } from "./session-contract";
import { clearScreen } from "./ui";

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

type UsePromotionInput = {
  version: string;
  session: Session;
  currentSessionId: string;
  rowsRef: { current: ChatRow[] };
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
};

type UsePromotionResult = {
  promotedRows: PromotedItem[];
  promote: () => void;
  clearTranscript: (sessionId?: string) => void;
  setPromotedRows: (updater: (prev: PromotedItem[]) => PromotedItem[]) => void;
};

export function usePromotion(input: UsePromotionInput): UsePromotionResult {
  const [promotedRows, setPromotedRows] = useState<PromotedItem[]>(() => [
    createHeaderItem(input.version, input.session.id),
    ...toRows(input.session.messages),
  ]);

  const promote = useCallback(() => {
    const current = input.rowsRef.current;
    log.debug("chat.promote.trigger", { rows: current.length });
    if (current.length === 0) return;
    const promotedIds = new Set(current.map((row) => row.id));
    setPromotedRows((prev) => appendPromotedItems(prev, current));
    input.setRows((live) => {
      const surviving = live.filter((row) => !promotedIds.has(row.id));
      log.debug("chat.promote.done", { promoted: promotedIds.size, surviving: surviving.length });
      return surviving;
    });
  }, [input.rowsRef, input.setRows]);

  const currentSessionIdRef = useRef(input.currentSessionId);
  currentSessionIdRef.current = input.currentSessionId;

  const clearCountRef = useRef(0);

  const clearTranscript = useCallback(
    (sessionId?: string) => {
      clearScreen();
      clearCountRef.current += 1;
      const id = sessionId ?? currentSessionIdRef.current;
      const header = createHeaderItem(input.version, id);
      header.id = `${header.id}_${clearCountRef.current}`;
      setPromotedRows((prev) => [...prev, header]);
      input.setRows(() => []);
    },
    [input.version, input.setRows],
  );

  return { promotedRows, promote, clearTranscript, setPromotedRows };
}
