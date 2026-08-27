import { type ChatRow, createRow, type RowOutcome } from "./chat-contract";
import type { TranscriptRow } from "./chat-transcript-contract";
import type { StreamEvent } from "./client-contract";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { createId } from "./short-id";
import type { TasklistItem } from "./tasklist-contract";
import type { ToolOutputPart, ToolOutputSurface } from "./tool-output-contract";
import { createToolOutputState } from "./tool-output-render";
import { REVEAL_FRAME_MS } from "./tool-policy";

type OutputEntry = { toolCallId: string; toolName: string; content: ToolOutputPart; transient?: boolean };

type ToolResultEntry = {
  toolCallId: string;
  toolName: string;
  isError?: boolean;
  errorCode?: string;
  error?: { category?: string; [key: string]: unknown };
};

export type MessageStreamState = {
  /** The single interpreter: translate one stream event into row mutations. Non-row
   *  events (status/usage/reasoning) are ignored — the caller owns those. */
  onEvent: (event: StreamEvent) => void;
  onDelta: (delta: string) => void;
  onTextEnd: () => void;
  onToolCall: () => void;
  onOutput: (entry: OutputEntry) => void;
  onToolResult: (entry: ToolResultEntry) => void;
  onTasklist: (entry: { groupId: string; groupTitle: string; items: TasklistItem[] }) => void;
  onProgressError: (error: string) => void;
  onProgressNotice: (notice: { message: string; level: "warn" | "error"; source?: string }) => void;
  streamedText: () => string;
  /** Flush remaining buffered prose and detach: seal the live agent row and drop unresolved tasklist rows. */
  finalize: () => void;
  dispose: () => void;
};

// Prose reveals at a constant DRIP_CHARS per frame, rounded out to a whole word. The pace is the
// display's, not the provider's: a smooth stream, a rate-limited one arriving in bursts, and a
// provider that returns the whole answer at once all read alike.
const DRIP_CHARS = 8;

const graphemes = new Intl.Segmenter();

export function createMessageStreamState(input: {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setTranscriptPresentation?: (updater: (current: TranscriptRow[]) => TranscriptRow[]) => void;
  setHeldRowIds?: (updater: (current: ReadonlySet<string>) => ReadonlySet<string>) => void;
  surface: ToolOutputSurface;
}): MessageStreamState {
  // --- agent streaming state ---
  let activeRowId: string | null = null;
  let agentContent = "";
  // Text received but not yet revealed. The tick drips it into `agentContent`; every path
  // that reads `agentContent` as the authoritative prose must drain this first.
  let pendingText = "";
  // A closed text block owes the next one a paragraph break. Held until that block actually
  // starts, so the last block of a turn leaves no trailing blank line.
  let paragraphPending = false;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  // Whether a delta landed since the last tick ran. A tick short of a word boundary holds only
  // while this is set: text still arriving may carry the boundary, a quiet stream never will.
  let deltaSinceTick = false;
  /** Every agent row ID we've created, so dispose() can remove them on the error path. */
  const agentRowIds: string[] = [];

  // --- tool output state ---
  const toolRowIdByCallId = new Map<string, string>();
  // Calls that have opened a row and are still waiting on a result.
  const unresolvedCallIds = new Set<string>();
  // Calls whose row is gone. Output of theirs still waiting behind a reveal must not open a new one.
  const droppedCallIds = new Set<string>();
  const toolOutput = createToolOutputState({ surface: input.surface });

  // --- tasklist state ---
  const tasklistRowIdByGroupId = new Map<string, string>();

  // Signature of the last row appended, when it was a progress notice — lets a repeat
  // notice dedupe even after the prior one was promoted out of the active region.
  // Cleared whenever any other row is appended, so only adjacent repeats collapse.
  let lastNoticeKey: string | null = null;

  function upsertTranscriptRow(row: TranscriptRow): void {
    input.setTranscriptPresentation?.((current) => {
      const index = current.findIndex((currentRow) => currentRow.id === row.id);
      if (index < 0) return [...current, row];
      const next = [...current];
      next[index] = row;
      return next;
    });
  }

  function cancelTick(): void {
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  }

  // Reveal the whole backlog at once and stop pacing. The single chokepoint every seal/read
  // path routes through, so dripped-but-unrevealed text can never render after a later row
  // (reorder) or be lost when the closure resets.
  function drainBacklog(): void {
    if (pendingText.length > 0) {
      agentContent += pendingText;
      pendingText = "";
    }
    cancelTick();
  }

  function scheduleTick(): void {
    if (!tickTimer) tickTimer = setTimeout(tick, REVEAL_FRAME_MS);
  }

  /** Where to cut `text` so the reveal ends on a word, counting graphemes rather than code units so
   *  an emoji built from several of them is never split. A run longer than twice the budget has no
   *  boundary worth waiting for and is cut where it falls; 0 holds the text for a boundary a later
   *  delta may carry, which the quiet tick releases once the stream stops. */
  function wordBoundedCut(text: string, budget: number): number {
    let count = 0;
    let overrun = 0;
    for (const { segment, index } of graphemes.segment(text)) {
      count += 1;
      if (count <= budget) continue;
      if (/^\s/.test(segment)) return index;
      overrun += 1;
      if (overrun >= budget) return index;
    }
    return 0;
  }

  // Reveal one slice of the backlog and repaint.
  function tick(): void {
    tickTimer = null;
    if (pendingText.length === 0) return;
    const arrived = deltaSinceTick;
    deltaSinceTick = false;
    const cut = wordBoundedCut(pendingText, DRIP_CHARS);
    if (cut === 0) {
      if (arrived) {
        scheduleTick();
        return;
      }
      agentContent += pendingText;
      pendingText = "";
      flush();
      return;
    }
    agentContent += pendingText.slice(0, cut);
    pendingText = pendingText.slice(cut);
    flush();
    if (pendingText.length > 0) scheduleTick();
  }

  function flush(): void {
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
      // Prose must not be committed below a row that is still revealing: the row above would
      // grow afterwards and push this one down the screen. Queued parts only ever update a row
      // that already exists, so revealing them here cannot append a row of its own.
      if (waitForReveal(flush)) return;
      drainOutput();
      activeRowId = `row_${createId()}`;
      agentRowIds.push(activeRowId);
    }
    const id = activeRowId;
    input.setRows((current) =>
      current.some((row) => row.id === id)
        ? current.map((row) => (row.id === id ? { ...row, content } : row))
        : [...current, { id, kind: "assistant" as const, content }],
    );
    upsertTranscriptRow({ id, kind: "assistant", status: "active", content: { kind: "message", text: content } });
  }

  /** Reveal any backlog, flush, and detach from the current agent row. */
  function sealAgentRow(): void {
    drainBacklog();
    flush();
    if (activeRowId)
      input.setTranscriptPresentation?.((current) =>
        current.map((row) => (row.id === activeRowId ? { ...row, status: "complete" } : row)),
      );
    activeRowId = null;
    agentContent = "";
    paragraphPending = false;
  }

  function renderOutput(entry: OutputEntry): void {
    const update = toolOutput.push(entry);
    if (!update) return;

    const existingRowId = toolRowIdByCallId.get(entry.toolCallId);
    if (!existingRowId) {
      // A tool row can only follow finalized prose. The semantic transcript uses that status
      // to preserve the front-anchored promotion boundary across subsequent turns.
      sealAgentRow();
      // Nothing opens beneath a row that is still revealing, or that row would grow and push this
      // one down. A queued part only updates a row that exists, so this cannot reach back here.
      drainOutput();
      const rowId = `row_${createId()}`;
      toolRowIdByCallId.set(entry.toolCallId, rowId);
      unresolvedCallIds.add(entry.toolCallId);
      lastNoticeKey = null;
      input.setRows((current) => {
        return [...current, { id: rowId, kind: "tool" as const, content: { parts: update.items } }];
      });
      upsertTranscriptRow({
        id: rowId,
        kind: "tool",
        status: "active",
        content: { kind: "tool-output", output: { parts: update.items } },
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
    input.setTranscriptPresentation?.((current) =>
      current.map((row) =>
        row.id === existingRowId && row.content.kind === "tool-output"
          ? { ...row, content: { kind: "tool-output", output: { parts: update.items } } }
          : row,
      ),
    );
  }

  // A mutation arrives in one burst — a diff is computed and sent whole. Revealing it a row at a
  // time is presentation only: the same rows, in the same order, one per frame whatever the result's
  // size, so the reader watches it arrive at a pace that never changes under them.
  const outputBacklog = new Map<string, OutputEntry[]>();
  /** Rows whose result has landed while output is still arriving. A row is kept out of scrollback
   *  until every part it holds is on screen, or it would freeze without the rest. */
  const heldRows = new Map<string, string>();
  // The calls whose rows are paced. Nothing else is queued, so this is also what a reveal in flight
  // means.
  const pacedCallIds = new Set<string>();
  // Work parked until a reveal finishes, in the order it arrived.
  const parkedWork: Array<() => void> = [];
  let outputTimer: ReturnType<typeof setTimeout> | null = null;

  function holdRow(rowId: string): void {
    input.setHeldRowIds?.((current) => new Set(current).add(rowId));
  }

  function freeRow(rowId: string): void {
    input.setHeldRowIds?.((current) => {
      if (!current.has(rowId)) return current;
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
  }

  function removeRows(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return;
    input.setRows((current) => current.filter((row) => !ids.has(row.id)));
    input.setTranscriptPresentation?.((current) => current.filter((row) => !ids.has(row.id)));
  }

  function markOutcome(rowId: string, outcome: RowOutcome): void {
    input.setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, style: { ...row.style, outcome } } : row)),
    );
    input.setTranscriptPresentation?.((current) =>
      current.map((row) => (row.id === rowId ? { ...row, status: outcome } : row)),
    );
  }

  /** Give a row back to scrollback: everything it holds is on screen and nothing can revise it. */
  function releaseCall(callId: string): void {
    pacedCallIds.delete(callId);
    const rowId = heldRows.get(callId);
    if (!rowId) return;
    heldRows.delete(callId);
    freeRow(rowId);
  }

  function releaseAllCalls(): void {
    for (const callId of [...heldRows.keys()]) releaseCall(callId);
  }

  function markToolResult(entry: ToolResultEntry): void {
    const budgetExhausted =
      entry.isError &&
      (entry.errorCode === LIFECYCLE_ERROR_CODES.budgetExhausted || entry.error?.category === "budget-exhausted");
    if (budgetExhausted) {
      outputBacklog.delete(entry.toolCallId);
      heldRows.delete(entry.toolCallId);
      pacedCallIds.delete(entry.toolCallId);
      droppedCallIds.add(entry.toolCallId);
      const rowId = toolRowIdByCallId.get(entry.toolCallId);
      toolRowIdByCallId.delete(entry.toolCallId);
      unresolvedCallIds.delete(entry.toolCallId);
      toolOutput.delete(entry.toolCallId);
      if (!rowId) return;
      freeRow(rowId);
      removeRows(new Set([rowId]));
      return;
    }
    const rowId = toolRowIdByCallId.get(entry.toolCallId);
    // A result can outrun its own first output part, which is still waiting behind another call's
    // reveal. Queue the outcome behind that part, so it marks the row the part opens.
    if (!rowId) {
      waitForReveal(() => markToolResult(entry));
      return;
    }
    unresolvedCallIds.delete(entry.toolCallId);
    const outcome = entry.isError ? "error" : "success";
    // The call is over the moment its result lands, so its row says so. What waits is the
    // replacement of its output, and with it the row's scrollback.
    markOutcome(rowId, outcome);
    // Already fully revealed: there is nothing left to wait for, so the row is free to promote.
    if (!outputBacklog.has(entry.toolCallId)) {
      pacedCallIds.delete(entry.toolCallId);
      return;
    }
    heldRows.set(entry.toolCallId, rowId);
    holdRow(rowId);
  }

  /** Mark every call the turn left without a result. A row still reading as live front-anchors
   *  promotion, so everything below it is repainted for the rest of the session. */
  function cancelUnresolvedCalls(): void {
    for (const callId of [...unresolvedCallIds]) {
      unresolvedCallIds.delete(callId);
      const rowId = toolRowIdByCallId.get(callId);
      if (rowId) markOutcome(rowId, "cancelled");
    }
  }

  function scheduleOutputTick(): void {
    if (!outputTimer) outputTimer = setTimeout(releaseOutput, REVEAL_FRAME_MS);
  }

  function releaseOutput(): void {
    outputTimer = null;
    for (const [callId, queued] of [...outputBacklog]) {
      const next = queued.shift();
      if (next) renderOutput(next);
      if (queued.length === 0) {
        outputBacklog.delete(callId);
        releaseCall(callId);
      }
    }
    // Work parked behind the reveal goes as soon as the last of it is on screen.
    if (outputBacklog.size > 0) scheduleOutputTick();
    else releaseParkedWork();
  }

  function releaseParkedWork(): void {
    for (const work of parkedWork.splice(0, parkedWork.length)) work();
  }

  function revealInFlight(): boolean {
    return outputBacklog.size > 0;
  }

  /** Work that would open a row waits while a shape is still revealing. Cutting the reveal short is
   *  what made its last rows unreadable, and committing under a row that then grows pushes it down. */
  function waitForReveal(work: () => void): boolean {
    if (!revealInFlight()) return false;
    parkedWork.push(work);
    return true;
  }

  /** Reveal everything still queued. Every path that ends a turn routes through here, so a row can
   *  never gain a line after it stopped being the live one. */
  function drainOutput(): void {
    for (const [id, queued] of [...outputBacklog]) {
      outputBacklog.delete(id);
      for (const entry of queued) renderOutput(entry);
    }
    if (outputTimer) {
      clearTimeout(outputTimer);
      outputTimer = null;
    }
    releaseAllCalls();
    releaseParkedWork();
  }

  function enqueueOutput(entry: OutputEntry): void {
    if (droppedCallIds.has(entry.toolCallId)) return;
    // A stream renderer cannot revise a row it has printed, so pacing there would only delay the
    // output. A running command's tail is already paced by the tool and is replaced wholesale, so
    // pacing it again would only delay what the reader is watching for.
    if (input.surface === "stream" || entry.transient) {
      renderOutput(entry);
      return;
    }
    if (entry.content.kind === "edit-header") pacedCallIds.add(entry.toolCallId);
    // The first part places the row. Holding it back would let prose that arrives later be
    // committed above output that happened before it, inverting the transcript; once the row
    // exists, every later part only updates it in place and order is fixed.
    if (!toolRowIdByCallId.has(entry.toolCallId)) {
      // Gated before the state push: re-running this entry after the wait must not double-count it.
      if (waitForReveal(() => enqueueOutput(entry))) return;
      renderOutput(entry);
      return;
    }
    // Only a mutation is paced. Everything else either appeared as it happened — a running command's
    // tail — or was known in full when the tool returned, and animating that invents an arrival.
    if (!pacedCallIds.has(entry.toolCallId)) {
      renderOutput(entry);
      return;
    }
    const queued = outputBacklog.get(entry.toolCallId);
    if (queued) queued.push(entry);
    else outputBacklog.set(entry.toolCallId, [entry]);
    scheduleOutputTick();
  }

  const state: MessageStreamState = {
    onEvent: (event) => {
      switch (event.type) {
        case "text-delta":
          state.onDelta(event.text);
          break;
        case "text-end":
          state.onTextEnd();
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
        case "tasklist":
          state.onTasklist(event);
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
      if (paragraphPending) {
        paragraphPending = false;
        if (agentContent.length > 0 || pendingText.length > 0) pendingText += "\n\n";
      }
      pendingText += delta;
      deltaSinceTick = true;
      scheduleTick();
    },

    // A block boundary is a paragraph break, not an interruption: nothing happened between
    // the two blocks, so they stay one row. Sealing is reserved for a tool call, where the
    // assistant genuinely stopped to do work.
    onTextEnd: () => {
      // The block is over, so its last word has nothing left to wait for.
      drainBacklog();
      flush();
      paragraphPending = true;
    },

    onToolCall: () => {
      sealAgentRow();
    },

    onOutput: enqueueOutput,

    onToolResult: markToolResult,

    onTasklist: (entry) => {
      const content = { groupId: entry.groupId, groupTitle: entry.groupTitle, items: entry.items };
      const existingRowId = tasklistRowIdByGroupId.get(entry.groupId);
      if (!existingRowId) {
        sealAgentRow();
        const rowId = `row_${createId()}`;
        tasklistRowIdByGroupId.set(entry.groupId, rowId);
        lastNoticeKey = null;
        input.setRows((current) => [...current, { id: rowId, kind: "task" as const, content }]);
        upsertTranscriptRow({
          id: rowId,
          kind: "task",
          status: "active",
          content: { kind: "tasklist", output: content },
        });
        return;
      }
      input.setRows((current) => current.map((row) => (row.id === existingRowId ? { ...row, content } : row)));
      input.setTranscriptPresentation?.((current) =>
        current.map((row) =>
          row.id === existingRowId ? { ...row, content: { kind: "tasklist", output: content } } : row,
        ),
      );
    },

    onProgressError: (error) => {
      // Flush buffered prose first so it renders before the notice, not after the
      // pending flush timer fires (which would invert their order).
      sealAgentRow();
      const key = `error:${error}`;
      if (key !== lastNoticeKey) {
        input.setRows((current) => [...current, createRow("system", error, { outcome: "error" })]);
        lastNoticeKey = key;
      }
    },

    onProgressNotice: (notice) => {
      sealAgentRow();
      const outcome = notice.level === "error" ? "error" : "warning";
      const key = `${outcome}:${notice.message}`;
      if (key !== lastNoticeKey) {
        input.setRows((current) => [...current, createRow("system", notice.message, { outcome })]);
        lastNoticeKey = key;
      }
    },

    streamedText: () => agentContent + pendingText,

    finalize: () => {
      drainOutput();
      sealAgentRow();
      cancelUnresolvedCalls();
      const tasklistIds = new Set(tasklistRowIdByGroupId.values());
      tasklistRowIdByGroupId.clear();
      removeRows(tasklistIds);
      agentRowIds.length = 0;
    },

    dispose: () => {
      drainOutput();
      cancelUnresolvedCalls();
      cancelTick();
      const tasklistIds = new Set(tasklistRowIdByGroupId.values());
      tasklistRowIdByGroupId.clear();
      const idsToRemove = [...agentRowIds];
      if (activeRowId && !idsToRemove.includes(activeRowId)) idsToRemove.push(activeRowId);
      activeRowId = null;
      agentContent = "";
      pendingText = "";
      agentRowIds.length = 0;
      removeRows(new Set([...idsToRemove, ...tasklistIds]));
    },
  };

  return state;
}
