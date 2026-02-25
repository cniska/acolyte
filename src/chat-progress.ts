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
  onTool: (entry: {
    message: string;
    toolCallId?: string;
    toolName?: string;
    phase?: "tool_start" | "tool_chunk" | "tool_end";
  }) => void;
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
  const toolSnapshotByCallId = new Map<string, string>();

  const apply = (events: ChatProgressEvent[]): void => {
    if (events.length === 0) {
      return;
    }
    progressAfterSeq = events[events.length - 1]?.seq ?? progressAfterSeq;
    const rawToolMessages: Array<{
      message: string;
      dedupeKey: string;
      toolCallId?: string;
      toolName?: string;
      phase?: "tool_start" | "tool_chunk" | "tool_end";
    }> = [];
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
      rawToolMessages.push({
        message,
        dedupeKey,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: event.phase,
      });
    }
    const grouped: Array<{
      message: string;
      dedupeKey: string;
      toolCallId?: string;
      toolName?: string;
      phase?: "tool_start" | "tool_chunk" | "tool_end";
    }> = [];
    const groupedIndexByToolCallId = new Map<string, number>();
    for (const entry of rawToolMessages) {
      if (entry.toolCallId) {
        const previousSnapshot = toolSnapshotByCallId.get(entry.toolCallId);
        if (previousSnapshot) {
          const previousLower = previousSnapshot.trim().toLowerCase();
          const incomingLower = entry.message.trim().toLowerCase();
          if (incomingLower !== previousLower) {
            if (entry.message.startsWith(`${previousSnapshot}\n`)) {
              entry.message = entry.message.trim();
            } else if (!previousSnapshot.startsWith(`${entry.message}\n`)) {
              const existingLines = previousSnapshot.split("\n").map((line) => line.trim().toLowerCase());
              if (!existingLines.includes(incomingLower)) {
                entry.message = `${previousSnapshot}\n${entry.message.trim()}`;
              } else {
                entry.message = previousSnapshot;
              }
            } else {
              entry.message = previousSnapshot;
            }
          } else {
            entry.message = previousSnapshot;
          }
        }
        const existingIndex = groupedIndexByToolCallId.get(entry.toolCallId);
        if (existingIndex === undefined) {
          grouped.push({
            message: entry.message,
            dedupeKey: entry.dedupeKey,
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            phase: entry.phase,
          });
          groupedIndexByToolCallId.set(entry.toolCallId, grouped.length - 1);
          toolSnapshotByCallId.set(entry.toolCallId, entry.message);
          continue;
        }
        const existing = grouped[existingIndex];
        if (!existing) {
          continue;
        }
        const existingContent = existing.message.trim();
        const incomingContent = entry.message.trim();
        const existingLower = existingContent.toLowerCase();
        const incomingLower = incomingContent.toLowerCase();
        if (incomingLower === existingLower) {
          existing.toolName = entry.toolName ?? existing.toolName;
          existing.phase = entry.phase ?? existing.phase;
          toolSnapshotByCallId.set(entry.toolCallId, existing.message);
          continue;
        }
        if (incomingContent.startsWith(`${existingContent}\n`)) {
          existing.message = incomingContent;
          existing.toolName = entry.toolName ?? existing.toolName;
          existing.phase = entry.phase ?? existing.phase;
          toolSnapshotByCallId.set(entry.toolCallId, existing.message);
          continue;
        }
        if (existingContent.startsWith(`${incomingContent}\n`)) {
          existing.toolName = entry.toolName ?? existing.toolName;
          existing.phase = entry.phase ?? existing.phase;
          toolSnapshotByCallId.set(entry.toolCallId, existing.message);
          continue;
        }
        const existingLines = existingContent.split("\n").map((line) => line.trim().toLowerCase());
        if (existingLines.includes(incomingLower)) {
          existing.toolName = entry.toolName ?? existing.toolName;
          existing.phase = entry.phase ?? existing.phase;
          toolSnapshotByCallId.set(entry.toolCallId, existing.message);
          continue;
        }
        existing.message = `${existingContent}\n${incomingContent}`;
        existing.toolName = entry.toolName ?? existing.toolName;
        existing.phase = entry.phase ?? existing.phase;
        toolSnapshotByCallId.set(entry.toolCallId, existing.message);
        continue;
      }
      if (grouped.length === 0) {
        grouped.push({
          message: entry.message,
          dedupeKey: entry.dedupeKey,
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          phase: entry.phase,
        });
        continue;
      }
      if (isToolHeaderLine(entry.message)) {
        const previous = grouped[grouped.length - 1];
        if (previous) {
          const previousContent = previous.message.trim();
          const incomingContent = entry.message.trim();
          if (
            previousContent.toLowerCase() === incomingContent.toLowerCase() ||
            previousContent.toLowerCase().startsWith(`${incomingContent.toLowerCase()}\n`)
          ) {
            continue;
          }
        }
        grouped.push({
          message: entry.message,
          dedupeKey: entry.dedupeKey,
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          phase: entry.phase,
        });
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
      const eventDedupeKey = entry.toolCallId
        ? `${entry.toolCallId}|${message.toLowerCase()}`
        : `${entry.dedupeKey}|${message.toLowerCase()}`;
      if (dedupe) {
        if (seenToolMessages.has(eventDedupeKey)) {
          continue;
        }
        seenToolMessages.add(eventDedupeKey);
      }
      toolMessages.push(message);
      options.onTool({
        message,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        phase: entry.phase,
      });
    }
  };

  return {
    apply,
    afterSeq: () => progressAfterSeq,
    toolMessages: () => [...toolMessages],
  };
}
