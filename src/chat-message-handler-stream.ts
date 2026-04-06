import { type ChatRow, createRow } from "./chat-contract";
import type { ChecklistItem } from "./checklist-contract";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { palette } from "./palette";
import { createId } from "./short-id";
import { createToolOutputState, type ToolOutputPart } from "./tool-output-content";

export type MessageStreamState = {
  onDelta: (delta: string) => void;
  onToolCall: () => void;
  onOutput: (entry: { toolCallId: string; toolName: string; content: ToolOutputPart }) => void;
  onToolResult: (entry: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    errorCode?: string;
    error?: { category?: string; [key: string]: unknown };
  }) => void;
  onChecklist: (entry: { groupId: string; groupTitle: string; items: ChecklistItem[] }) => void;
  onProgressError: (error: string) => void;
  streamedText: () => string;
  /** Flush remaining content and return IDs of all streaming agent rows (for replacement by final turn rows). */
  finalize: () => string[];
  dispose: () => void;
};

const STREAM_FLUSH_MS = 50;

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
}): MessageStreamState {
  // --- agent streaming state ---
  let activeRowId: string | null = null;
  let agentContent = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every agent row ID we've created. Collected at finalize for caller to remove. */
  const agentRowIds: string[] = [];

  // --- tool output state ---
  const toolRowIdByCallId = new Map<string, string>();
  const toolOutput = createToolOutputState();

  // --- checklist state ---
  const checklistRowIdByGroupId = new Map<string, string>();

  function cancelFlushTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flush(): void {
    cancelFlushTimer();
    if (agentContent.trim().length === 0) return;
    input.setRows((current) => {
      if (!activeRowId) {
        const trimmed = agentContent.trim();
        if (trimmed.length === 0) return current;
        agentContent = trimmed;
        activeRowId = `row_${createId()}`;
        agentRowIds.push(activeRowId);
        return [...current, { id: activeRowId, kind: "assistant", content: agentContent }];
      }
      return current.map((row) => (row.id === activeRowId ? { ...row, content: agentContent } : row));
    });
  }

  /** Flush pending content and detach from the current agent row. */
  function sealAgentRow(): void {
    cancelFlushTimer();
    flush();
    activeRowId = null;
    agentContent = "";
  }

  return {
    onDelta: (delta) => {
      if (delta.length === 0) return;
      agentContent += delta;
      if (!flushTimer) flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    },

    onToolCall: () => {
      sealAgentRow();
    },

    onOutput: (entry) => {
      const update = toolOutput.push(entry);
      if (!update) return;

      const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!existingRowId) {
        // New tool call: seal any in-progress agent row and append tool row in one atomic update.
        cancelFlushTimer();
        const pendingContent = agentContent;
        const pendingRowId = activeRowId;
        activeRowId = null;
        agentContent = "";
        const rowId = `row_${createId()}`;
        toolRowIdByCallId.set(entry.toolCallId, rowId);
        input.setRows((current) => {
          let rows = current;
          if (pendingContent && pendingRowId) {
            rows = rows.map((row) => (row.id === pendingRowId ? { ...row, content: pendingContent } : row));
          } else if (pendingContent && pendingContent.trim().length > 0) {
            const id = `row_${createId()}`;
            agentRowIds.push(id);
            rows = [...rows, { id, kind: "assistant" as const, content: pendingContent }];
          }
          return [...rows, { id: rowId, kind: "tool" as const, content: { parts: update.items } }];
        });
        return;
      }
      // Existing tool call: update in place.
      input.setRows((current) => {
        const idx = current.findIndex((row) => row.id === existingRowId);
        if (idx < 0) return current;
        const existing = current[idx];
        if (!existing) return current;
        const next = [...current];
        next[idx] = { ...existing, content: { parts: update.items } };
        return next;
      });
    },

    onToolResult: (entry) => {
      const budgetExhausted =
        entry.isError &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.budgetExhausted || entry.error?.category === "budget-exhausted");
      if (budgetExhausted) {
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

    onChecklist: (entry) => {
      const content = { groupId: entry.groupId, groupTitle: entry.groupTitle, items: entry.items };
      const existingRowId = checklistRowIdByGroupId.get(entry.groupId);
      if (!existingRowId) {
        sealAgentRow();
        const rowId = `row_${createId()}`;
        checklistRowIdByGroupId.set(entry.groupId, rowId);
        input.setRows((current) => [...current, { id: rowId, kind: "task" as const, content }]);
        return;
      }
      input.setRows((current) => current.map((row) => (row.id === existingRowId ? { ...row, content } : row)));
    },

    onProgressError: (error) => {
      input.setRows((current) => {
        const last = current[current.length - 1];
        if (last?.style?.text === palette.error && last.content === error) return current;
        return [...current, createRow("system", error, { dim: true, text: palette.error })];
      });
    },

    streamedText: () => agentContent,

    finalize: () => {
      sealAgentRow();
      const checklistIds = new Set(checklistRowIdByGroupId.values());
      checklistRowIdByGroupId.clear();
      if (checklistIds.size > 0) {
        input.setRows((current) => current.filter((row) => !checklistIds.has(row.id)));
      }
      const ids = [...agentRowIds];
      agentRowIds.length = 0;
      return ids;
    },

    dispose: () => {
      cancelFlushTimer();
      const checklistIds = new Set(checklistRowIdByGroupId.values());
      checklistRowIdByGroupId.clear();
      const idsToRemove = [...agentRowIds];
      if (activeRowId && !idsToRemove.includes(activeRowId)) idsToRemove.push(activeRowId);
      activeRowId = null;
      agentContent = "";
      agentRowIds.length = 0;
      const removeSet = new Set([...idsToRemove, ...checklistIds]);
      if (removeSet.size > 0) {
        input.setRows((current) => current.filter((row) => !removeSet.has(row.id)));
      }
    },
  };
}
