import { type ChatRow, createRow } from "./chat-commands";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { renderToolOutput, renderToolOutputContent, type ToolOutput } from "./tool-output-content";

type ToolOutputEntry = {
  toolCallId: string;
  toolName: string;
  content: ToolOutput;
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
  onOutput: (entry: ToolOutputEntry) => void;
  onToolResult: (entry: ToolResultEntry) => void;
  onProgressError: (error: string) => void;
  streamedAssistantText: () => string;
};

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
}): MessageStreamState {
  let streamingAssistantRowId: string | null = null;
  let streamingAssistantContent = "";
  const toolRowIdByCallId = new Map<string, string>();
  const toolContentByCallId = new Map<string, ToolOutput[]>();
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
      return current.map((row) =>
        row.id === streamingAssistantRowId ? { ...row, content: streamingAssistantContent } : row,
      );
    });
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
    onOutput: (entry) => {
      const items = toolContentByCallId.get(entry.toolCallId) ?? [];
      const incoming = renderToolOutput(entry.content);
      const lastItem = items[items.length - 1];
      if (lastItem && renderToolOutput(lastItem) === incoming) return;
      items.push(entry.content);
      toolContentByCallId.set(entry.toolCallId, items);
      const rendered = renderToolOutputContent(items);
      if (!rendered) return;

      const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!existingRowId) {
        if (streamingAssistantContent.trim().length > 0) streamingAssistantContent = "";
        streamingAssistantRowId = null;
        const rowId = `row_${createId()}`;
        toolRowIdByCallId.set(entry.toolCallId, rowId);
        const firstItem = items[0];
        const label = firstItem?.kind === "tool-header" ? firstItem.label : undefined;
        input.setRows((current) => [
          ...current,
          {
            id: rowId,
            role: "assistant",
            content: rendered,
            style: "toolProgress",
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            toolLabel: label,
          },
        ]);
        return;
      }
      input.setRows((current) => {
        const existingIndex = current.findIndex((row) => row.id === existingRowId);
        const existingRow = existingIndex >= 0 ? current[existingIndex] : undefined;
        if (!existingRow || existingRow.content === rendered) return current;
        const next = [...current];
        next[existingIndex] = { ...existingRow, content: rendered };
        return next;
      });
    },
    onToolResult: (entry) => {
      const guardBlocked =
        entry.isError &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.errorDetail?.category === "guard-blocked");
      if (guardBlocked) {
        const rowId = toolRowIdByCallId.get(entry.toolCallId);
        toolRowIdByCallId.delete(entry.toolCallId);
        toolContentByCallId.delete(entry.toolCallId);
        if (!rowId) return;
        input.setRows((current) => current.filter((row) => row.id !== rowId));
        return;
      }
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
    streamedAssistantText: () => streamingAssistantContent,
  };
}
