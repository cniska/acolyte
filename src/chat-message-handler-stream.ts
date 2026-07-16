import { type ChatRow, createRow } from "./chat-contract";
import type { ChecklistItem } from "./checklist-contract";
import type { StreamEvent } from "./client-contract";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { palette } from "./palette";
import { createId } from "./short-id";
import type { ToolOutputPart } from "./tool-output-contract";
import { createToolOutputState } from "./tool-output-render";

export type MessageStreamState = {
  /** The single interpreter: translate one stream event into row mutations. Non-row
   *  events (status/usage/reasoning) are ignored — the caller owns those. */
  onEvent: (event: StreamEvent) => void;
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
  onProgressNotice: (notice: { message: string; level: "warn" | "error"; source?: string }) => void;
  streamedText: () => string;
  /** Flush remaining buffered prose and detach: seal the live agent row and drop unresolved checklist rows. */
  finalize: () => void;
  dispose: () => void;
};

const STREAM_FLUSH_MS = 50;

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  promoteRows?: (rows: readonly ChatRow[]) => void;
}): MessageStreamState {
  // --- agent streaming state ---
  let activeRowId: string | null = null;
  let agentContent = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every agent row ID we've created, so dispose() can remove them on the error path. */
  const agentRowIds: string[] = [];

  // --- tool output state ---
  const toolRowIdByCallId = new Map<string, string>();
  // Tool rows still streaming output (no result yet) — mutable, so they block
  // promotion of everything below them until resolved.
  const pendingToolRowIds = new Set<string>();
  const toolOutput = createToolOutputState();

  // --- checklist state ---
  const checklistRowIdByGroupId = new Map<string, string>();

  // Signature of the last row appended, when it was a progress notice — lets a repeat
  // notice dedupe even after the prior one was promoted out of the active region.
  // Cleared whenever any other row is appended, so only adjacent repeats collapse.
  let lastNoticeKey: string | null = null;

  function cancelFlushTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  // Move the longest contiguous prefix of finalized rows into write-once scrollback.
  // A row is still mutable — and blocks the prefix — while it is the live prose row,
  // an unresolved tool row, or a checklist row (which is removed, not promoted, at
  // finalize). Static renders above the whole active region, so promoting anything
  // but a front-anchored prefix would reorder the transcript.
  function promoteFinalizedPrefix(): void {
    if (!input.promoteRows) return;
    const checklistRowIds = new Set(checklistRowIdByGroupId.values());
    const blocked = (id: string): boolean => id === activeRowId || pendingToolRowIds.has(id) || checklistRowIds.has(id);
    input.setRows((current) => {
      let n = 0;
      while (n < current.length && !blocked(current[n]?.id ?? "")) n++;
      if (n === 0) return current;
      input.promoteRows?.(current.slice(0, n));
      return current.slice(n);
    });
  }

  function flush(): void {
    cancelFlushTimer();
    // Leading whitespace stripped every call so `content` is a pure function of
    // agentContent (no mutation), keeping the updater idempotent.
    const content = agentContent.replace(/^\s+/, "");
    if (content.length === 0) return;
    lastNoticeKey = null;
    // Row identity is assigned OUTSIDE the updater: React may invoke a setRows
    // updater more than once (StrictMode) or after sealAgentRow/finalize reset
    // the closure, so the updater must be a pure function of `current` only —
    // any id creation / tracking mutation inside it desyncs agentRowIds from the
    // committed rows and silently drops the answer.
    if (!activeRowId) {
      activeRowId = `row_${createId()}`;
      agentRowIds.push(activeRowId);
    }
    const id = activeRowId;
    input.setRows((current) =>
      current.some((row) => row.id === id)
        ? current.map((row) => (row.id === id ? { ...row, content } : row))
        : [...current, { id, kind: "assistant" as const, content }],
    );
  }

  /** Flush pending content and detach from the current agent row. */
  function sealAgentRow(): void {
    cancelFlushTimer();
    flush();
    activeRowId = null;
    agentContent = "";
  }

  const state: MessageStreamState = {
    onEvent: (event) => {
      switch (event.type) {
        case "text-delta":
          state.onDelta(event.text);
          break;
        case "tool-call":
          state.onToolCall();
          break;
        case "tool-output":
          state.onOutput(event);
          break;
        case "tool-result":
          state.onToolResult(event);
          break;
        case "checklist":
          state.onChecklist(event);
          break;
        case "error":
          state.onProgressError(event.errorMessage);
          break;
        case "notice":
          state.onProgressNotice({ message: event.message, level: event.level, source: event.source });
          break;
      }
    },

    onDelta: (delta) => {
      if (delta.length === 0) return;
      agentContent += delta;
      if (!flushTimer) flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    },

    onToolCall: () => {
      sealAgentRow();
      promoteFinalizedPrefix();
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
        pendingToolRowIds.add(rowId);
        lastNoticeKey = null;
        // Decide (and track) any fallback assistant row OUTSIDE the updater, for
        // the same pure-updater reason as flush().
        const fallbackAssistantId =
          !(pendingContent && pendingRowId) && pendingContent.trim().length > 0 ? `row_${createId()}` : null;
        if (fallbackAssistantId) agentRowIds.push(fallbackAssistantId);
        input.setRows((current) => {
          let rows = current;
          if (pendingContent && pendingRowId) {
            rows = rows.map((row) => (row.id === pendingRowId ? { ...row, content: pendingContent } : row));
          } else if (fallbackAssistantId) {
            rows = current.some((row) => row.id === fallbackAssistantId)
              ? rows.map((row) => (row.id === fallbackAssistantId ? { ...row, content: pendingContent } : row))
              : [...rows, { id: fallbackAssistantId, kind: "assistant" as const, content: pendingContent }];
          }
          return [...rows, { id: rowId, kind: "tool" as const, content: { parts: update.items } }];
        });
        promoteFinalizedPrefix();
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
        pendingToolRowIds.delete(rowId);
        input.setRows((current) => current.filter((row) => row.id !== rowId));
        return;
      }
      const rowId = toolRowIdByCallId.get(entry.toolCallId);
      if (!rowId) return;
      const markerColor = entry.isError ? palette.error : palette.success;
      input.setRows((current) =>
        current.map((row) => (row.id === rowId ? { ...row, style: { ...row.style, marker: markerColor } } : row)),
      );
      // The marker is now final, so the row is immutable: promote it (and any prefix
      // it was blocking) into write-once scrollback.
      pendingToolRowIds.delete(rowId);
      promoteFinalizedPrefix();
    },

    onChecklist: (entry) => {
      const content = { groupId: entry.groupId, groupTitle: entry.groupTitle, items: entry.items };
      const existingRowId = checklistRowIdByGroupId.get(entry.groupId);
      if (!existingRowId) {
        sealAgentRow();
        const rowId = `row_${createId()}`;
        checklistRowIdByGroupId.set(entry.groupId, rowId);
        lastNoticeKey = null;
        input.setRows((current) => [...current, { id: rowId, kind: "task" as const, content }]);
        promoteFinalizedPrefix();
        return;
      }
      input.setRows((current) => current.map((row) => (row.id === existingRowId ? { ...row, content } : row)));
    },

    onProgressError: (error) => {
      // Flush buffered prose first so it renders before the notice, not after the
      // pending flush timer fires (which would invert their order).
      sealAgentRow();
      const key = `error:${error}`;
      if (key !== lastNoticeKey) {
        input.setRows((current) => [...current, createRow("system", error, { dim: true, text: palette.error })]);
        lastNoticeKey = key;
      }
      promoteFinalizedPrefix();
    },

    onProgressNotice: (notice) => {
      sealAgentRow();
      const color = notice.level === "error" ? palette.error : palette.yellow;
      const key = `${color}:${notice.message}`;
      if (key !== lastNoticeKey) {
        input.setRows((current) => [...current, createRow("system", notice.message, { dim: true, text: color })]);
        lastNoticeKey = key;
      }
      promoteFinalizedPrefix();
    },

    streamedText: () => agentContent,

    finalize: () => {
      sealAgentRow();
      const checklistIds = new Set(checklistRowIdByGroupId.values());
      checklistRowIdByGroupId.clear();
      if (checklistIds.size > 0) {
        input.setRows((current) => current.filter((row) => !checklistIds.has(row.id)));
      }
      agentRowIds.length = 0;
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

  return state;
}
