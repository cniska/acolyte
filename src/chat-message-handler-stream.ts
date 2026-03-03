import { formatToolHeader } from "./agent-output";
import { createRow, type ChatRow } from "./chat-commands";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { mergeToolOutputHeader, shouldSuppressEmptyToolProgressRow } from "./tool-summary-format";

type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

type ToolOutputEntry = {
  toolCallId: string;
  toolName: string;
  content: string;
};

type ToolResultEntry = {
  toolCallId: string;
  toolName: string;
  isError?: boolean;
  errorCode?: string;
  errorDetail?: { category?: string; [key: string]: unknown };
};

export type MessageStreamState = {
  onAssistantDelta: (delta: string) => boolean;
  flushStreamingContent: () => void;
  clearStreamFlushTimer: () => void;
  scheduleStreamFlush: () => void;
  clearStreamingAssistantRow: () => string | null;
  clearStreamingAssistantContent: () => void;
  flushPendingToolRows: () => void;
  onToolCall: (entry: ToolCallEntry) => void;
  onToolOutput: (entry: ToolOutputEntry) => void;
  onToolResult: (entry: ToolResultEntry) => void;
  onProgressError: (error: string) => void;
  streamedAssistantText: () => string;
  committedStreamingText: () => string;
  toolHeaders: () => Set<string>;
};

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
}): MessageStreamState {
  let streamingAssistantRowId: string | null = null;
  let streamingAssistantContent = "";
  let committedStreamingText = "";
  const toolRowIdByCallId = new Map<string, string>();
  const toolSeenLinesByCallId = new Map<string, Set<string>>();
  const pendingToolCallById = new Map<string, { header: string; toolName: string }>();
  const toolHasBodyOutputByCallId = new Set<string>();
  const toolHeaders = new Set<string>();
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const STREAM_FLUSH_MS = 50;

  const flushStreamingContent = (): void => {
    if (streamFlushTimer) {
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
    if (streamingAssistantContent.trim().length === 0) return;
    input.setRows((current) => {
      if (!streamingAssistantRowId) {
        streamingAssistantRowId = `row_${createId()}`;
        return [
          ...current,
          {
            id: streamingAssistantRowId,
            role: "assistant",
            content: streamingAssistantContent,
          },
        ];
      }
      return current.map((row) => (row.id === streamingAssistantRowId ? { ...row, content: streamingAssistantContent } : row));
    });
  };

  const ensureToolRow = (toolCallId: string): void => {
    const pending = pendingToolCallById.get(toolCallId);
    if (!pending) return;
    if (toolRowIdByCallId.get(toolCallId)) return;
    const rowId = `row_${createId()}`;
    toolRowIdByCallId.set(toolCallId, rowId);
    toolSeenLinesByCallId.set(toolCallId, new Set([pending.header.toLowerCase()]));
    toolHeaders.add(pending.header.toLowerCase());
    const toolRow: ChatRow = {
      id: rowId,
      role: "assistant",
      content: pending.header,
      style: "toolProgress",
      toolCallId,
      toolName: pending.toolName,
    };
    if (streamingAssistantContent.trim().length > 0) committedStreamingText += streamingAssistantContent;
    streamingAssistantRowId = null;
    streamingAssistantContent = "";
    input.setRows((current) => [...current, toolRow]);
    pendingToolCallById.delete(toolCallId);
  };

  return {
    onAssistantDelta: (delta) => {
      if (delta.length === 0) return false;
      streamingAssistantContent += delta;
      return true;
    },
    flushStreamingContent,
    clearStreamFlushTimer: () => {
      if (!streamFlushTimer) return;
      clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    },
    scheduleStreamFlush: () => {
      if (!streamFlushTimer) streamFlushTimer = setTimeout(flushStreamingContent, STREAM_FLUSH_MS);
    },
    clearStreamingAssistantRow: () => {
      const pendingStreamRowId = streamingAssistantRowId;
      streamingAssistantRowId = null;
      return pendingStreamRowId;
    },
    clearStreamingAssistantContent: () => {
      streamingAssistantContent = "";
    },
    flushPendingToolRows: () => {
      for (const toolCallId of [...pendingToolCallById.keys()]) ensureToolRow(toolCallId);
    },
    onToolCall: (entry) => {
      const header = formatToolHeader(entry.toolName, entry.args);
      pendingToolCallById.set(entry.toolCallId, { header, toolName: entry.toolName });
    },
    onToolOutput: (entry) => {
      const content = entry.content.trim();
      if (!content) return;
      ensureToolRow(entry.toolCallId);
      input.setRows((current) => {
        const normalizedLine = content.toLowerCase();
        const seenLines = toolSeenLinesByCallId.get(entry.toolCallId) ?? new Set<string>();
        if (seenLines.has(normalizedLine)) return current;
        seenLines.add(normalizedLine);
        toolSeenLinesByCallId.set(entry.toolCallId, seenLines);
        const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
        const existingIndex = existingRowId ? current.findIndex((row) => row.id === existingRowId) : -1;
        const existingRow = existingIndex >= 0 ? current[existingIndex] : undefined;
        if (!existingRow) {
          const rowId = `row_${createId()}`;
          toolRowIdByCallId.set(entry.toolCallId, rowId);
          return [
            ...current,
            {
              id: rowId,
              role: "assistant",
              content,
              style: "toolProgress",
              toolCallId: entry.toolCallId,
              toolName: entry.toolName,
            },
          ];
        }
        const next = [...current];
        const mergedHeader = !existingRow.content.includes("\n")
          ? mergeToolOutputHeader(existingRow.content, entry.toolName, content)
          : null;
        if (mergedHeader) {
          toolHasBodyOutputByCallId.add(entry.toolCallId);
          next[existingIndex] = {
            ...existingRow,
            content: mergedHeader,
          };
          return next;
        }
        toolHasBodyOutputByCallId.add(entry.toolCallId);
        next[existingIndex] = {
          ...existingRow,
          content: `${existingRow.content}\n${content}`,
        };
        return next;
      });
    },
    onToolResult: (entry) => {
      const guardBlocked =
        entry.isError &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.errorDetail?.category === "guard-blocked");
      if (guardBlocked) {
        pendingToolCallById.delete(entry.toolCallId);
        const rowId = toolRowIdByCallId.get(entry.toolCallId);
        toolRowIdByCallId.delete(entry.toolCallId);
        toolSeenLinesByCallId.delete(entry.toolCallId);
        toolHasBodyOutputByCallId.delete(entry.toolCallId);
        if (!rowId) return;
        input.setRows((current) => current.filter((row) => row.id !== rowId));
        return;
      }
      if (!toolHasBodyOutputByCallId.has(entry.toolCallId) && shouldSuppressEmptyToolProgressRow(entry.toolName)) {
        pendingToolCallById.delete(entry.toolCallId);
        const rowId = toolRowIdByCallId.get(entry.toolCallId);
        toolRowIdByCallId.delete(entry.toolCallId);
        toolSeenLinesByCallId.delete(entry.toolCallId);
        if (!rowId) return;
        input.setRows((current) => current.filter((row) => row.id !== rowId));
        return;
      }
      ensureToolRow(entry.toolCallId);
      const rowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!rowId) return;
      const status: ChatRow["toolStatus"] = entry.isError ? "error" : "ok";
      input.setRows((current) => current.map((row) => (row.id === rowId ? { ...row, toolStatus: status } : row)));
    },
    onProgressError: (error) => {
      input.setRows((current) => {
        const last = current[current.length - 1];
        if (last?.style === "error" && last.content === error) return current;
        return [...current, createRow("system", error, { dim: true, style: "error" })];
      });
    },
    streamedAssistantText: () => `${committedStreamingText}${streamingAssistantContent}`,
    committedStreamingText: () => committedStreamingText,
    toolHeaders: () => toolHeaders,
  };
}
