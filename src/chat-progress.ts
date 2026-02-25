import type { ChatProgressEvent } from "./backend";
import { isToolDetailLine, isToolHeaderLine } from "./tool-progress";

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
    const rawToolMessages: Array<{ message: string; dedupeKey: string }> = [];
    for (const event of events) {
      const message = event.message.trim();
      if (!message) {
        continue;
      }
      if (event.kind === "status" || isStageProgressMessage(message)) {
        options.onStatus(message);
        continue;
      }
      const dedupeKey =
        event.toolCallId && event.toolCallId.length > 0
          ? `${event.toolCallId}:${event.phase ?? ""}:${message.toLowerCase()}`
          : message.toLowerCase();
      rawToolMessages.push({ message, dedupeKey });
    }
    const grouped: Array<{ message: string; dedupeKey: string }> = [];
    for (const entry of rawToolMessages) {
      if (grouped.length === 0) {
        grouped.push({ message: entry.message, dedupeKey: entry.dedupeKey });
        continue;
      }
      if (isToolHeaderLine(entry.message)) {
        grouped.push({ message: entry.message, dedupeKey: entry.dedupeKey });
        continue;
      }
      const previous = grouped[grouped.length - 1];
      const previousFirstLine = previous?.message.split("\n")[0] ?? "";
      if (
        previous &&
        (isToolHeaderLine(previousFirstLine) || (isToolDetailLine(previous.message) && isToolDetailLine(entry.message)))
      ) {
        const existingLines = previous.message.split("\n").map((line) => line.trim().toLowerCase());
        if (existingLines.includes(entry.message.trim().toLowerCase())) {
          continue;
        }
        previous.message = `${previous.message}\n${entry.message}`;
        continue;
      }
      grouped.push({ message: entry.message, dedupeKey: entry.dedupeKey });
    }
    for (const entry of grouped) {
      const message = entry.message;
      const eventDedupeKey = entry.dedupeKey;
      if (dedupe) {
        if (seenToolMessages.has(eventDedupeKey)) {
          continue;
        }
        seenToolMessages.add(eventDedupeKey);
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
