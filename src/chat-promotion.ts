import { useCallback, useRef, useState } from "react";
import type { ChatRow } from "./chat-contract";
import { toRows } from "./chat-session";
import { legacyChatRowFromTranscript, migrateLegacyChatRow, type TranscriptRow } from "./chat-transcript-contract";
import type { Session } from "./session-contract";
import { createId } from "./short-id";
import { layoutHeader } from "./terminal-chat-layout";
import { clearTerminal } from "./tui";
import { freezeSlice, type PromotedSceneSlice } from "./tui/scene-viewport";

// Resume populates the active scene, so seed both the semantic rows and the id-matched
// ChatRows the projection needs; pre-parity sessions migrate their messages. `freshIds`
// re-ids an in-process re-open so a redisplay never collides in the append-only slice log.
export function resumeActiveTranscript(
  session: Session,
  freshIds = false,
): { rows: ChatRow[]; presentation: TranscriptRow[] } {
  // Clamp a persisted `active` status: an active section front-anchors promotion forever.
  const semantic = (session.transcriptPresentation ?? toRows(session.messages).map(migrateLegacyChatRow)).map((row) =>
    row.status === "active" ? { ...row, status: "complete" as const } : row,
  );
  const presentation = freshIds ? semantic.map((row) => ({ ...row, id: `row_${createId()}` })) : semantic;
  return { presentation, rows: presentation.map(legacyChatRowFromTranscript) };
}

// Segment 0 keeps the bare id so a single-session process matches the legacy header id;
// later segments (a /clear or in-app switch) version it so the append-only scrollback log
// never dedupes a fresh segment's header against the prior one.
export function createHeaderSlice(version: string, sessionId: string, segment: number): PromotedSceneSlice {
  const id = segment === 0 ? `header_${sessionId}` : `header_${sessionId}_${segment}`;
  return freezeSlice(id, layoutHeader({ title: "Acolyte", version, sessionId }).lines);
}

export function appendPromotedSlices(
  current: PromotedSceneSlice[],
  next: readonly PromotedSceneSlice[],
): PromotedSceneSlice[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((slice) => slice.id));
  const appended: PromotedSceneSlice[] = [];
  for (const slice of next) {
    if (seen.has(slice.id)) continue;
    seen.add(slice.id);
    appended.push(slice);
  }
  return appended.length > 0 ? [...current, ...appended] : current;
}

// Owns write-once slice scrollback: the header slice (seeded, versioned per segment) plus
// the row slices the render loop commits as they scroll past the terminal-fit boundary.
export function useScenePromotion(input: { version: string; session: Session }): {
  promotedSlices: PromotedSceneSlice[];
  appendSlices: (slices: readonly PromotedSceneSlice[]) => void;
  openSegment: (sessionId: string) => void;
} {
  const [promotedSlices, setPromotedSlices] = useState<PromotedSceneSlice[]>(() => [
    createHeaderSlice(input.version, input.session.id, 0),
  ]);
  const segmentRef = useRef(0);
  const appendSlices = useCallback((slices: readonly PromotedSceneSlice[]) => {
    setPromotedSlices((prev) => appendPromotedSlices(prev, slices));
  }, []);
  const openSegment = useCallback(
    (sessionId: string) => {
      clearTerminal();
      segmentRef.current += 1;
      setPromotedSlices((prev) => [...prev, createHeaderSlice(input.version, sessionId, segmentRef.current)]);
    },
    [input.version],
  );
  return { promotedSlices, appendSlices, openSegment };
}
