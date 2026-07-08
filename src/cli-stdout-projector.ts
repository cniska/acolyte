import { stdout as output } from "node:process";
import { type ChatRow, isChecklistOutput, isToolOutput } from "./chat-contract";
import { formatChecklist } from "./checklist-format";
import { formatAgentReplyOutput, printIndentedDim } from "./cli-format";
import { palette } from "./palette";
import { renderToolOutput } from "./tool-output-render";
import { printDim, printError, printOutput, printWarning, streamText } from "./ui";

// If the final answer extends the streamed preview, return the un-streamed tail; if it
// equals it, return "" (already shown). Divergence returns "" too — a known run-mode gap
// (the final answer is dropped) that the fold's follow-up commit addresses.
function missingAgentStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

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
    const rendered = renderToolOutput(row.content.parts);
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
            if (!emittedRowIds.has(row.id)) renderChecklist(row);
            break;
          case "system":
            if (!emittedRowIds.has(row.id) && typeof row.content === "string") {
              // Honor the notice/error level carried on the row style (warn→yellow,
              // error→red), the unified colouring run mode previously lacked.
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
      const missingTail = missingAgentStreamTail(agentStreamText, replyOutput);
      if (missingTail.length > 0) {
        writeRaw(missingTail);
        if (!atLineStart) output.write("\n");
      } else if (!agentStreamStarted) {
        const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
        await streamText(formatAgentReplyOutput(replyOutput, wrapWidth));
      }
    },
  };
}
