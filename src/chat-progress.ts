import type { ChatProgressEvent } from "./backend";

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

function isStageProgressMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.startsWith("Retrying with ")) {
    return false;
  }
  return STAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function createProgressTracker(options: {
  onStatus: (message: string) => void;
  onAssistant?: (delta: string) => void;
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

  const apply = (events: ChatProgressEvent[]): void => {
    if (events.length === 0) {
      return;
    }
    progressAfterSeq = events[events.length - 1]?.seq ?? progressAfterSeq;
    for (const event of events) {
      const rawMessage = event.message;
      if (rawMessage.length === 0) {
        continue;
      }
      if (event.kind === "assistant") {
        options.onAssistant?.(rawMessage);
        continue;
      }
      const message = rawMessage.trim();
      if (!message) {
        continue;
      }
      if (event.kind === "status" || isStageProgressMessage(message)) {
        options.onStatus(message);
        continue;
      }
      const dedupeKey = event.toolCallId
        ? `${event.toolCallId}|${message.toLowerCase()}`
        : `${event.phase ?? ""}|${message.toLowerCase()}`;
      if (dedupe && seenToolMessages.has(dedupeKey)) {
        continue;
      }
      if (dedupe) {
        seenToolMessages.add(dedupeKey);
      }
      toolMessages.push(message);
      options.onTool({
        message,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: event.phase,
      });
    }
  };

  return {
    apply,
    afterSeq: () => progressAfterSeq,
    toolMessages: () => [...toolMessages],
  };
}
