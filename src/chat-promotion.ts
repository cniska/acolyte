import { useCallback, useRef, useState } from "react";
import type { ChatRow } from "./chat-contract";
import type { HeaderLine } from "./chat-header";
import { toRows } from "./chat-session";
import { log } from "./log";
import type { Session } from "./session-contract";
import { createId } from "./short-id";
import { clearScreen } from "./ui";

export type HeaderItem = { id: string; kind: "header"; sessionId: string; lines: HeaderLine[] };
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

export function isHeaderItem(item: PromotedItem): item is HeaderItem {
  return "kind" in item && item.kind === "header";
}

export function createHeaderItem(version: string, sessionId: string): HeaderItem {
  return {
    id: `header_${sessionId}`,
    kind: "header",
    sessionId,
    lines: [
      { id: "title", text: "Acolyte" },
      { id: "session", text: `version ${version}` },
      { id: "context", text: `session ${sessionId}` },
    ],
  };
}

/** The current session's display transcript is the tail of the append-only log: every
 *  row after the last header. Headers partition the process-lifetime log into per-session
 *  segments, so this is the single source of truth for what one session displays. */
export function currentSegment(items: PromotedItem[]): { sessionId: string | null; rows: ChatRow[] } {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && isHeaderItem(item)) {
      return {
        sessionId: item.sessionId,
        rows: items.slice(i + 1).filter((row): row is ChatRow => !isHeaderItem(row)),
      };
    }
  }
  return { sessionId: null, rows: [] };
}

type UsePromotionInput = {
  version: string;
  session: Session;
  currentSessionId: string;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
};

type UsePromotionResult = {
  promotedRows: PromotedItem[];
  promote: () => void;
  promoteRows: (rows: readonly ChatRow[]) => void;
  resumeTranscript: (session: Session) => void;
  clearTranscript: (sessionId?: string) => void;
  setPromotedRows: (updater: (prev: PromotedItem[]) => PromotedItem[]) => void;
};

export function usePromotion(input: UsePromotionInput): UsePromotionResult {
  const [promotedRows, setPromotedRows] = useState<PromotedItem[]>(() => [
    createHeaderItem(input.version, input.session.id),
    // Resume from the persisted display projection when present (byte-exact live/resume
    // parity); pre-parity sessions have none, so fall back to the collapsed messages.
    ...(input.session.transcript ?? toRows(input.session.messages)),
  ]);

  const promote = useCallback(() => {
    input.setRows((current) => {
      log.debug("chat.promote.trigger", { rows: current.length });
      if (current.length === 0) return current;
      setPromotedRows((prev) => appendPromotedItems(prev, current));
      log.debug("chat.promote.done", { promoted: current.length, surviving: 0 });
      return [];
    });
  }, [input.setRows]);

  // Promote a finalized prefix of the active region mid-turn. Write-once scrollback
  // is immutable, so a row must be settled before it moves; the caller guarantees the
  // rows are finalized. appendPromotedItems dedupes by id, keeping the paired
  // setState idempotent under StrictMode's double-invoke.
  const promoteRows = useCallback((rows: readonly ChatRow[]) => {
    if (rows.length === 0) return;
    setPromotedRows((prev) => appendPromotedItems(prev, rows));
  }, []);

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

  // Open a new segment for an in-app session switch, seeded with the target's transcript.
  // Fresh row ids: the log is process-lifetime and Static keys by id, so reusing the
  // target's persisted ids (or the deterministic ids from toRows) would collide with an
  // earlier display of the same session and get deduped away.
  const resumeTranscript = useCallback(
    (session: Session) => {
      clearScreen();
      clearCountRef.current += 1;
      const header = createHeaderItem(input.version, session.id);
      header.id = `${header.id}_${clearCountRef.current}`;
      const seed = (session.transcript ?? toRows(session.messages)).map((row) => ({
        ...row,
        id: `row_${createId()}`,
      }));
      setPromotedRows((prev) => [...prev, header, ...seed]);
      input.setRows(() => []);
    },
    [input.version, input.setRows],
  );

  return { promotedRows, promote, promoteRows, resumeTranscript, clearTranscript, setPromotedRows };
}
