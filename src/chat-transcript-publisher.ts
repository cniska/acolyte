import type { ChatRow } from "./chat-contract";
import { migrateLegacyChatRow, type TranscriptRow } from "./chat-transcript-contract";

const PUBLISHED_KINDS = new Set<ChatRow["kind"]>(["system", "status", "task"]);

export function createTranscriptPublisher(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setPresentation: (updater: (current: TranscriptRow[]) => TranscriptRow[]) => void;
}): (updater: (current: ChatRow[]) => ChatRow[]) => void {
  return (updater) => {
    input.setRows((current) => {
      const next = updater(current);
      const published = next.filter((row) => PUBLISHED_KINDS.has(row.kind));
      input.setPresentation((presentation) => {
        const publishedIds = new Set(published.map((row) => row.id));
        return [...presentation.filter((row) => !publishedIds.has(row.id)), ...published.map(migrateLegacyChatRow)];
      });
      return next;
    });
  };
}
