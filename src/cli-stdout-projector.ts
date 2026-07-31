import { stdout as output } from "node:process";
import { type ChatRow, isToolOutput } from "./chat-contract";
import { rowMarker } from "./chat-row-marker";
import { formatAgentReplyOutput, formatIndentedDim, TOOL_BODY_INDENT } from "./cli-format";
import { renderToolOutput } from "./tool-output-render";
import { errorText, formatMarkerLine, streamText, warningText, writeChunk } from "./ui";

/**
 * Projects the row model (fed by MessageStreamState.onEvent) onto append-only stdout,
 * reproducing run mode's incremental rendering. Diffs each row against what it has
 * already emitted so growing tool output and streamed text print only their new tail —
 * the relocation of cli-prompt's hand-rolled `snapshotByCallId` logic.
 *
 * Every write goes through `writeLine`/`writeStream`, the sole owners of newline
 * discipline: streamed prose is the one emitter that can leave a line open, and any
 * whole-line emitter closes it first.
 */
export function createStdoutRowProjector(): {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  renderError: (message: string) => void;
  renderReply: (replyOutput: string) => Promise<void>;
} {
  let rows: ChatRow[] = [];
  let midLine = false;
  let openStreamRowId: string | null = null;
  let agentStreamText = "";
  let assistantMarker = "";
  let assistantRowId = "";
  let hasPrintedProgress = false;

  const emittedAssistant = new Map<string, string>();
  const emittedTool = new Map<string, string>();
  const emittedRowIds = new Set<string>();

  function endLine(): void {
    if (!midLine) return;
    writeChunk("\n");
    midLine = false;
  }

  function writeLine(text: string): void {
    endLine();
    writeChunk(`${text}\n`);
  }

  function writeStream(rowId: string, marker: string, text: string): void {
    let remaining = text;
    while (remaining.length > 0) {
      if (!midLine) {
        writeChunk(openStreamRowId === rowId ? "  " : `${marker} `);
        openStreamRowId = rowId;
        midLine = true;
      }
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) {
        writeChunk(remaining);
        return;
      }
      writeChunk(`${remaining.slice(0, newlineIndex)}\n`);
      midLine = false;
      remaining = remaining.slice(newlineIndex + 1);
    }
  }

  function renderAssistant(row: ChatRow): void {
    assistantMarker = rowMarker(row).glyph;
    assistantRowId = row.id;
    const full = typeof row.content === "string" ? row.content : "";
    const prev = emittedAssistant.get(row.id) ?? "";
    const delta = full.startsWith(prev) ? full.slice(prev.length) : full;
    emittedAssistant.set(row.id, full);
    agentStreamText = full;
    writeStream(row.id, assistantMarker, delta);
  }

  function renderTool(row: ChatRow): void {
    if (!isToolOutput(row.content)) return;
    const parts = row.content.parts;
    // A lone header with no detail carries nothing to show yet — wait for real content.
    if (parts.length === 1 && parts[0]?.kind === "tool-header" && !parts[0].detail) return;
    const rendered = renderToolOutput(parts, Math.max(24, (output.columns ?? 120) - TOOL_BODY_INDENT));
    const previous = emittedTool.get(row.id);
    emittedTool.set(row.id, rendered);
    if (previous !== undefined) {
      const current = rendered.trimEnd();
      const before = previous.trimEnd();
      if (current === before) return;
      if (current.startsWith(`${before}\n`)) {
        writeLine(formatIndentedDim(current.slice(before.length + 1)));
        hasPrintedProgress = true;
        return;
      }
      const currentLines = current.split("\n");
      const previousLines = before.split("\n");
      if (currentLines.length > previousLines.length) {
        writeLine(formatIndentedDim(currentLines.slice(previousLines.length).join("\n")));
        hasPrintedProgress = true;
      }
      return;
    }
    const marker = rowMarker(row);
    writeLine(formatMarkerLine(marker.glyph, marker.color, rendered.split("\n")[0] ?? ""));
    if (rendered.includes("\n")) writeLine(formatIndentedDim(rendered.slice(rendered.indexOf("\n") + 1)));
    hasPrintedProgress = true;
  }

  return {
    setRows: (updater) => {
      const next = updater(rows);
      for (const row of next) {
        switch (row.kind) {
          case "assistant":
            renderAssistant(row);
            break;
          case "tool":
            renderTool(row);
            break;
          case "system":
            if (!emittedRowIds.has(row.id) && typeof row.content === "string") {
              // Color by the notice/error level carried on the row's semantic outcome:
              // error→red, everything else (warning)→yellow.
              writeLine(row.style?.outcome === "error" ? errorText(row.content) : warningText(row.content));
              hasPrintedProgress = true;
            }
            break;
        }
        emittedRowIds.add(row.id);
      }
      rows = next;
    },

    renderError: (message) => {
      writeLine(errorText(message));
    },

    renderReply: async (replyOutput) => {
      writeLine("");
      if (hasPrintedProgress) writeLine("");
      // reply.output is the authoritative answer, printed in full exactly once; the
      // streamed deltas are a preview, reused only when they equal it (no-op) or prefix
      // it (print the tail). reply.output is trimmed upstream while the preview keeps
      // trailing whitespace, so compare trimmed — else a lone trailing newline reads as
      // divergence and reprints the whole answer.
      const streamed = agentStreamText.trimEnd();
      if (replyOutput === streamed) return;
      if (streamed.length > 0 && replyOutput.startsWith(streamed)) {
        writeStream(assistantRowId, assistantMarker, replyOutput.slice(streamed.length));
        endLine();
        return;
      }
      const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
      await streamText(formatAgentReplyOutput(replyOutput, wrapWidth));
    },
  };
}
