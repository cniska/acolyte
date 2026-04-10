import { stdout as output } from "node:process";
import { createWorkspaceSpecifier } from "./api";
import { createMessage } from "./chat-session";
import { formatChecklist } from "./checklist-format";
import { formatAgentReplyOutput, printIndentedDim } from "./cli-format";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { formatPromptError } from "./error-messages";
import { t } from "./i18n";
import {
  appendLifecycleTextDelta,
  createLifecycleTextStreamState,
  extractLifecycleSignal,
  finalizeLifecycleText,
} from "./lifecycle-signal";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { createToolOutputState, formatToolOutput } from "./tool-output-content";
import { printDim, printError, printOutput, streamText } from "./ui";

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== t("chat.session.default_title")) return;
  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
}

function missingAgentStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

function createAgentStreamRenderer(): {
  onDelta: (delta: string) => void;
  renderReply: (replyOutput: string, hasPrintedProgress: boolean) => Promise<void>;
  streamedText: () => string;
} {
  let agentStreamStarted = false;
  let renderedText = "";
  let lastMeaningfulChunk = "";
  let atLineStart = true;
  const lifecycleTextState = createLifecycleTextStreamState();

  const writeRaw = (text: string): void => {
    if (text.length === 0) return;
    let remaining = text;
    while (remaining.length > 0) {
      if (atLineStart) {
        const prefix = agentStreamStarted ? "  " : "• ";
        process.stdout.write(prefix);
        agentStreamStarted = true;
      }
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) {
        process.stdout.write(remaining);
        atLineStart = false;
        break;
      }
      process.stdout.write(`${remaining.slice(0, newlineIndex)}\n`);
      remaining = remaining.slice(newlineIndex + 1);
      atLineStart = true;
    }
  };

  const dedupeChunk = (chunk: string): string => {
    if (chunk.length === 0) return "";
    if (chunk === "\n" && renderedText.endsWith("\n")) return "";
    if (renderedText.endsWith(chunk) || renderedText.endsWith(`\n${chunk}`)) return "";
    const trimmed = chunk.trim();
    if (trimmed.length > 0 && trimmed === lastMeaningfulChunk) return "";

    let overlap = Math.min(renderedText.length, chunk.length);
    while (overlap > 0 && !renderedText.endsWith(chunk.slice(0, overlap))) overlap--;
    const append = chunk.slice(overlap);
    if (append.trim().length > 0) lastMeaningfulChunk = append.trim();
    return append;
  };

  const renderChunk = (chunk: string): void => {
    const deduped = dedupeChunk(chunk);
    if (deduped.length === 0) return;
    renderedText += deduped;
    writeRaw(deduped);
  };

  return {
    onDelta: (delta) => {
      if (delta.length === 0) return;
      const visible = appendLifecycleTextDelta(lifecycleTextState, delta);
      renderChunk(visible);
    },
    renderReply: async (replyOutput, hasPrintedProgress) => {
      const finalized = finalizeLifecycleText(lifecycleTextState);
      if (finalized.text.length > 0) renderChunk(finalized.text);
      if (!atLineStart) process.stdout.write("\n");
      printOutput("");
      if (hasPrintedProgress) printOutput("");
      const missingTail = missingAgentStreamTail(renderedText, replyOutput);
      if (missingTail.length > 0) {
        renderChunk(missingTail);
        if (!atLineStart) process.stdout.write("\n");
      } else if (!agentStreamStarted) {
        const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
        await streamText(formatAgentReplyOutput(replyOutput, wrapWidth));
      }
    },
    streamedText: () => renderedText,
  };
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client: Client,
  options?: { resourceId?: ResourceId; workspace?: string },
): Promise<boolean> {
  const userMsg = createMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${prompt}`);
    const agentRenderer = createAgentStreamRenderer();
    const toolOutput = createToolOutputState();
    const snapshotByCallId = new Map<string, string>();
    let hasPrintedToolProgress = false;

    const reply = await client.replyStream(
      {
        message: prompt,
        history: session.messages,
        model: session.model,
        sessionId: session.id,
        resourceId: options?.resourceId,
        ...createWorkspaceSpecifier(options?.workspace),
      },
      {
        onEvent: (event) => {
          switch (event.type) {
            case "text-delta":
              agentRenderer.onDelta(event.text);
              break;
            case "tool-output": {
              const update = toolOutput.push(event);
              if (!update) break;
              if (update.items.length === 1 && update.items[0]?.kind === "tool-header" && !update.items[0].detail)
                break;
              const rendered = formatToolOutput(update.items);
              if (!rendered) break;
              const previous = snapshotByCallId.get(event.toolCallId);
              snapshotByCallId.set(event.toolCallId, rendered);
              if (previous) {
                const current = rendered.trimEnd();
                const before = previous.trimEnd();
                if (current === before) break;
                if (current.startsWith(`${before}\n`)) {
                  printIndentedDim(current.slice(before.length + 1));
                  hasPrintedToolProgress = true;
                  break;
                }
                // Padding or formatting changed earlier lines — print only new trailing lines.
                const currentLines = current.split("\n");
                const previousLines = before.split("\n");
                if (currentLines.length > previousLines.length) {
                  printIndentedDim(currentLines.slice(previousLines.length).join("\n"));
                  hasPrintedToolProgress = true;
                  break;
                }
                break;
              }
              printDim(`• ${rendered.split("\n")[0] ?? ""}`);
              if (rendered.includes("\n")) printIndentedDim(rendered.slice(rendered.indexOf("\n") + 1));
              hasPrintedToolProgress = true;
              break;
            }
            case "checklist": {
              const { header, items } = formatChecklist(event);
              printDim(`• ${header}`);
              for (const item of items) printIndentedDim(`${item.marker} ${item.label}`);
              hasPrintedToolProgress = true;
              break;
            }
            case "tool-result": {
              const budgetExhausted =
                event.isError === true &&
                (event.errorCode === LIFECYCLE_ERROR_CODES.budgetExhausted ||
                  event.error?.category === "budget-exhausted");
              if (budgetExhausted) toolOutput.delete(event.toolCallId);
              break;
            }
          }
        },
      },
    );

    const { text: finalOutput } = extractLifecycleSignal(reply.output);
    if (reply.error) {
      printError(reply.error);
    } else {
      await agentRenderer.renderReply(finalOutput, hasPrintedToolProgress);
    }
    const assistantMessage = createMessage("assistant", finalOutput);
    session.messages.push(
      (reply.toolCalls?.length ?? 0) > 0 ? { ...assistantMessage, kind: "tool_payload" } : assistantMessage,
    );
    session.model = reply.model;
    session.updatedAt = nowIso();
    return true;
  } catch (error) {
    if (!(error instanceof Error)) printError(t("error.prompt.request_failed"));
    else printError(formatPromptError(error.message));
    session.updatedAt = nowIso();
    return false;
  }
}
