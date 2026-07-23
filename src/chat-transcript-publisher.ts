import type { ChatRow } from "./chat-contract";
import { migrateLegacyChatRow, type TranscriptRow } from "./chat-transcript-contract";

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
      const presentationIds = new Set(current.presentation.map((row) => row.id));
      return {
        rows,
        presentation: [
          ...current.presentation,
          ...rows.filter((row) => !presentationIds.has(row.id)).map(migrateLegacyChatRow),
        ],
      };
    });
  };
}
