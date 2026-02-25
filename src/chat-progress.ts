import type { ChatProgressEvent } from "./backend";
import { groupToolProgressMessages } from "./tool-progress";

const STAGE_PREFIXES = [
  "Thinking…",
  "Thinking...",
  "Planning…",
  "Planning...",
  "Coding…",
  "Coding...",
  "Working…",
  "Working...",
  "Reviewing…",
  "Reviewing...",
  "Summarizing…",
  "Summarizing...",
] as const;

export function isStageProgressMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.startsWith("Retrying with ")) {
    return false;
  }
  return STAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function createProgressTracker(options: {
  onStatus: (message: string) => void;
  onTool: (message: string) => void;
  dedupeToolMessages?: boolean;
}): {
  apply: (events: ChatProgressEvent[]) => void;
  afterSeq: () => number;
  toolMessages: () => string[];
} {
  const dedupe = options.dedupeToolMessages ?? true;
  let progressAfterSeq = 0;
  const seenToolMessages = new Set<string>();
  const toolMessages: string[] = [];

  const apply = (events: ChatProgressEvent[]): void => {
    if (events.length === 0) {
      return;
    }
    progressAfterSeq = events[events.length - 1]?.seq ?? progressAfterSeq;
    const rawToolMessages: string[] = [];
    for (const event of events) {
      const message = event.message.trim();
      if (!message) {
        continue;
      }
      if (event.kind === "status" || isStageProgressMessage(message)) {
        options.onStatus(message);
        continue;
      }
      rawToolMessages.push(message);
    }
    for (const message of groupToolProgressMessages(rawToolMessages)) {
      if (dedupe) {
        const key = message.toLowerCase();
        if (seenToolMessages.has(key)) {
          continue;
        }
        seenToolMessages.add(key);
      }
      toolMessages.push(message);
      options.onTool(message);
    }
  };

  return {
    apply,
    afterSeq: () => progressAfterSeq,
    toolMessages: () => [...toolMessages],
  };
}
