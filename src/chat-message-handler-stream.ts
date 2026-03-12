import { type ChatRow, createRow } from "./chat-commands";
import { palette } from "./palette";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { createToolOutputState, type ToolOutput } from "./tool-output-content";

export type MessageStreamState = {
  onAssistantDelta: (delta: string) => void;
  onOutput: (entry: { toolCallId: string; toolName: string; content: ToolOutput }) => void;
  onToolResult: (entry: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    errorCode?: string;
    error?: { category?: string; [key: string]: unknown };
  }) => void;
  onProgressError: (error: string) => void;
  streamedAssistantText: () => string;
  finalize: () => string | null;
  dispose: () => void;
};

const STREAM_FLUSH_MS = 50;

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
}): MessageStreamState {
  let streamingRowId: string | null = null;
  let streamingContent = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const toolRowIdByCallId = new Map<string, string>();
  const toolOutput = createToolOutputState();

  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (streamingContent.trim().length === 0) return;
    input.setRows((current) => {
      if (!streamingRowId) {
        streamingRowId = `row_${createId()}`;
        return [...current, { id: streamingRowId, role: "assistant", content: streamingContent }];
      }
      return current.map((row) => (row.id === streamingRowId ? { ...row, content: streamingContent } : row));
    });
  };

  return {
    onAssistantDelta: (delta) => {
      if (delta.length === 0) return;
      streamingContent += delta;
      if (!flushTimer) flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    },
    onOutput: (entry) => {
      const update = toolOutput.push(entry);
      if (!update) return;

      const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!existingRowId) {
        const orphanedRowId = streamingRowId;
        if (streamingContent.trim().length > 0) streamingContent = "";
        streamingRowId = null;
        const rowId = `row_${createId()}`;
        toolRowIdByCallId.set(entry.toolCallId, rowId);
        input.setRows((current) => [
          ...(orphanedRowId ? current.filter((row) => row.id !== orphanedRowId) : current),
          {
            id: rowId,
            role: "tool" as const,
            content: "",
            toolOutput: update.items,
          },
        ]);
        return;
      }
      input.setRows((current) => {
        const existingIndex = current.findIndex((row) => row.id === existingRowId);
        if (existingIndex < 0) return current;
        const next = [...current];
        const existing = current[existingIndex];
        if (!existing) return current;
        next[existingIndex] = { ...existing, toolOutput: update.items };
        return next;
      });
    },
    onToolResult: (entry) => {
      const guardBlocked =
        entry.isError &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.error?.category === "guard-blocked");
      if (guardBlocked) {
        const rowId = toolRowIdByCallId.get(entry.toolCallId);
        toolRowIdByCallId.delete(entry.toolCallId);
        toolOutput.delete(entry.toolCallId);
        if (!rowId) return;
        input.setRows((current) => current.filter((row) => row.id !== rowId));
        return;
      }
      const rowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!rowId) return;
      const markerColor = entry.isError ? palette.error : palette.success;
      input.setRows((current) =>
        current.map((row) => (row.id === rowId ? { ...row, style: { ...row.style, marker: markerColor } } : row)),
      );
    },
    onProgressError: (error) => {
      input.setRows((current) => {
        const last = current[current.length - 1];
        if (last?.style?.text === palette.error && last.content === error) return current;
        return [...current, createRow("system", error, { dim: true, text: palette.error })];
      });
    },
    streamedAssistantText: () => streamingContent,
    finalize: () => {
      // Flush any pending streaming content so the row exists before we hand off.
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
        flush();
      }
      const pendingRowId = streamingRowId;
      streamingRowId = null;
      streamingContent = "";
      return pendingRowId;
    },
    dispose: () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (streamingRowId) {
        const orphanedRowId = streamingRowId;
        streamingRowId = null;
        streamingContent = "";
        input.setRows((current) => current.filter((row) => row.id !== orphanedRowId));
      }
    },
  };
}
