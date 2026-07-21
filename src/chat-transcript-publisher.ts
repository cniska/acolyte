import type { ChatRow } from "./chat-contract";
import { migrateLegacyChatRow, type TranscriptRow } from "./chat-transcript-contract";

const PUBLISHED_KINDS = new Set<ChatRow["kind"]>(["system", "status", "task"]);

export type ActiveTranscriptState = {
  rows: ChatRow[];
  presentation: TranscriptRow[];
};

export function createTranscriptPublisher(input: {
  setTranscript: (updater: (current: ActiveTranscriptState) => ActiveTranscriptState) => void;
}): (updater: (current: ChatRow[]) => ChatRow[]) => void {
  return (updater) => {
    input.setTranscript((current) => {
      const rows = updater(current.rows);
      const published = rows.filter((row) => PUBLISHED_KINDS.has(row.kind));
      const publishedIds = new Set(published.map((row) => row.id));
      return {
        rows,
        presentation: [
          ...current.presentation.filter((row) => !publishedIds.has(row.id)),
          ...published.map(migrateLegacyChatRow),
        ],
      };
    });
  };
}
