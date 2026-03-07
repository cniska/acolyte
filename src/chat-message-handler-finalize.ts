import type { ChatRow } from "./chat-commands";
import { mergeAssistantTranscript } from "./chat-message-handler-helpers";

type BuildFinalAssistantRowsInput = {
  rows: ChatRow[];
  streamedAssistantText: string;
  committedStreamingText: string;
  toolHeaders: Set<string>;
};

function detailAfterVerb(value: string): string {
  return value
    .trim()
    .replace(/^\S+\s*/, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function isRedundantWithHeader(text: string, toolHeaders: Set<string>): boolean {
  const headerDetails = new Set([...toolHeaders].map(detailAfterVerb).filter((d) => d.length > 0));
  return headerDetails.size > 0 && headerDetails.has(detailAfterVerb(text));
}

export function createFinalAssistantRows(input: BuildFinalAssistantRowsInput): ChatRow[] {
  return input.rows
    .map((row) => {
      if (row.role !== "assistant" || row.dim || row.style) return row;
      const mergedContent = mergeAssistantTranscript(input.streamedAssistantText, row.content);
      if (input.committedStreamingText && mergedContent.startsWith(input.committedStreamingText)) {
        const after = mergedContent.slice(input.committedStreamingText.length).trim();
        if (!after) return null;
        return isRedundantWithHeader(after, input.toolHeaders) ? null : { ...row, content: after };
      }
      return isRedundantWithHeader(mergedContent.trim(), input.toolHeaders) ? null : { ...row, content: mergedContent };
    })
    .filter((row): row is ChatRow => row !== null);
}
