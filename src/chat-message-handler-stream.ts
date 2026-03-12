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
  /** Flush remaining content and return IDs of all streaming assistant rows (for replacement by final turn rows). */
  finalize: () => string[];
  dispose: () => void;
};

const STREAM_FLUSH_MS = 50;

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
}): MessageStreamState {
  // --- assistant streaming state ---
  let activeRowId: string | null = null;
  let activeContent = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every assistant row ID we've created. Collected at finalize for caller to remove. */
  const assistantRowIds: string[] = [];

  // --- tool output state ---
  const toolRowIdByCallId = new Map<string, string>();
  const toolOutput = createToolOutputState();

  function cancelFlushTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flush(): void {
    cancelFlushTimer();
    if (activeContent.trim().length === 0) return;
    input.setRows((current) => {
      if (!activeRowId) {
        activeRowId = `row_${createId()}`;
        assistantRowIds.push(activeRowId);
        return [...current, { id: activeRowId, role: "assistant", content: activeContent }];
      }
      return current.map((row) => (row.id === activeRowId ? { ...row, content: activeContent } : row));
    });
  }

  /** Flush pending content and detach from the current assistant row. */
  function sealAssistantRow(): void {
    cancelFlushTimer();
    flush();
    activeRowId = null;
    activeContent = "";
  }

  return {
    onAssistantDelta: (delta) => {
      if (delta.length === 0) return;
      activeContent += delta;
      if (!flushTimer) flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    },

    onOutput: (entry) => {
      const update = toolOutput.push(entry);
      if (!update) return;

      const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!existingRowId) {
        // New tool call: seal any in-progress assistant row (keeps it visible), then append tool row.
        sealAssistantRow();
        const rowId = `row_${createId()}`;
        toolRowIdByCallId.set(entry.toolCallId, rowId);
        input.setRows((current) => [
          ...current,
          { id: rowId, role: "tool" as const, content: "", toolOutput: update.items },
        ]);
        return;
      }
      // Existing tool call: update in place.
      input.setRows((current) => {
        const idx = current.findIndex((row) => row.id === existingRowId);
        if (idx < 0) return current;
        const existing = current[idx];
        if (!existing) return current;
        const next = [...current];
        next[idx] = { ...existing, toolOutput: update.items };
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

    streamedAssistantText: () => activeContent,

    finalize: () => {
      sealAssistantRow();
      const ids = [...assistantRowIds];
      assistantRowIds.length = 0;
      return ids;
    },

    dispose: () => {
      cancelFlushTimer();
      const idsToRemove = [...assistantRowIds];
      if (activeRowId && !idsToRemove.includes(activeRowId)) idsToRemove.push(activeRowId);
      activeRowId = null;
      activeContent = "";
      assistantRowIds.length = 0;
      if (idsToRemove.length > 0) {
        const removeSet = new Set(idsToRemove);
        input.setRows((current) => current.filter((row) => !removeSet.has(row.id)));
      }
    },
  };
}
