import { stdout as output } from "node:process";
import { type ChatRow, isChecklistOutput, isToolOutput } from "./chat-contract";
import { formatChecklist } from "./checklist-format";
import { formatAgentReplyOutput, printIndentedDim } from "./cli-format";
import { palette } from "./palette";
import { renderToolOutput } from "./tool-output-render";
import { printDim, printError, printOutput, printWarning, streamText } from "./ui";

/**
 * Projects the row model (fed by MessageStreamState.onEvent) onto append-only stdout,
 * reproducing run mode's incremental rendering. Diffs each row against what it has
 * already emitted so growing tool output and streamed text print only their new tail —
 * the relocation of cli-prompt's hand-rolled `snapshotByCallId` logic.
 */
export function createStdoutRowProjector(): {
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  renderReply: (replyOutput: string) => Promise<void>;
} {
  let rows: ChatRow[] = [];
  let atLineStart = true;
  let agentStreamStarted = false;
  let agentStreamText = "";
  let hasPrintedProgress = false;

  const emittedAssistant = new Map<string, string>();
  const emittedTool = new Map<string, string>();
  const emittedChecklist = new Map<string, string>();
  const emittedRowIds = new Set<string>();

  function writeRaw(text: string): void {
    if (text.length === 0) return;
    let remaining = text;
    while (remaining.length > 0) {
      if (atLineStart) {
        output.write(agentStreamStarted ? "  " : "• ");
        agentStreamStarted = true;
      }
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) {
        output.write(remaining);
        atLineStart = false;
        break;
      }
      output.write(`${remaining.slice(0, newlineIndex)}\n`);
      remaining = remaining.slice(newlineIndex + 1);
      atLineStart = true;
    }
  }

  function renderAssistant(row: ChatRow): void {
    const full = typeof row.content === "string" ? row.content : "";
    const prev = emittedAssistant.get(row.id) ?? "";
    const delta = full.startsWith(prev) ? full.slice(prev.length) : full;
    emittedAssistant.set(row.id, full);
    agentStreamText = full;
    writeRaw(delta);
  }

  function renderTool(row: ChatRow): void {
    if (!isToolOutput(row.content)) return;
    const parts = row.content.parts;
    // A lone header with no detail carries nothing to show yet — wait for real content.
    if (parts.length === 1 && parts[0]?.kind === "tool-header" && !parts[0].detail) return;
    const rendered = renderToolOutput(parts);
    const previous = emittedTool.get(row.id);
    emittedTool.set(row.id, rendered);
    if (previous !== undefined) {
      const current = rendered.trimEnd();
      const before = previous.trimEnd();
      if (current === before) return;
      if (current.startsWith(`${before}\n`)) {
        printIndentedDim(current.slice(before.length + 1));
        hasPrintedProgress = true;
        return;
      }
      const currentLines = current.split("\n");
      const previousLines = before.split("\n");
      if (currentLines.length > previousLines.length) {
        printIndentedDim(currentLines.slice(previousLines.length).join("\n"));
        hasPrintedProgress = true;
      }
      return;
    }
    printDim(`• ${rendered.split("\n")[0] ?? ""}`);
    if (rendered.includes("\n")) printIndentedDim(rendered.slice(rendered.indexOf("\n") + 1));
    hasPrintedProgress = true;
  }

  function renderChecklist(row: ChatRow): void {
    if (!isChecklistOutput(row.content)) return;
    const { header, items } = formatChecklist(row.content);
    // The stream reuses one row id per checklist group, so reprint on every content
    // change (progress update) but not when an unrelated event re-runs the projection.
    const rendered = `${header}\n${items.map((item) => `${item.marker} ${item.label}`).join("\n")}`;
    if (emittedChecklist.get(row.id) === rendered) return;
    emittedChecklist.set(row.id, rendered);
    printDim(`• ${header}`);
    for (const item of items) printIndentedDim(`${item.marker} ${item.label}`);
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
          case "task":
            renderChecklist(row);
            break;
          case "system":
            if (!emittedRowIds.has(row.id) && typeof row.content === "string") {
              // Color by the notice/error level carried on the row style: warn→yellow,
              // error→red.
              if (row.style?.text === palette.error) printError(row.content);
              else printWarning(row.content);
              hasPrintedProgress = true;
            }
            break;
        }
        emittedRowIds.add(row.id);
      }
      rows = next;
    },

    renderReply: async (replyOutput) => {
      if (!atLineStart) output.write("\n");
      printOutput("");
      if (hasPrintedProgress) printOutput("");
      // reply.output is the authoritative answer, printed in full exactly once; the
      // streamed deltas are a preview, reused only when they equal it (no-op) or prefix
      // it (print the tail). reply.output is trimmed upstream while the preview keeps
      // trailing whitespace, so compare trimmed — else a lone trailing newline reads as
      // divergence and reprints the whole answer.
      const streamed = agentStreamText.trimEnd();
      if (replyOutput === streamed) return;
      if (streamed.length > 0 && replyOutput.startsWith(streamed)) {
        writeRaw(replyOutput.slice(streamed.length));
        if (!atLineStart) output.write("\n");
        return;
      }
      const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
      await streamText(formatAgentReplyOutput(replyOutput, wrapWidth));
    },
  };
}
