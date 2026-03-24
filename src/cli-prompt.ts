import { stdout as output } from "node:process";
import { createWorkspaceSpecifier, type VerifyScope } from "./api";
import { createMessage } from "./chat-session";
import { formatChecklist } from "./checklist-format";
import { formatAssistantReplyOutput, printIndentedDim } from "./cli-format";
import type { Client } from "./client-contract";
import { nowIso } from "./datetime";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { formatPromptError } from "./error-messages";
import { t } from "./i18n";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { createToolOutputState, formatToolOutput } from "./tool-output-content";
import { printDim, printError, printOutput, streamText } from "./ui";

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== t("chat.session.default_title")) return;
  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
}

function missingAssistantStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

function createAssistantStreamRenderer(): {
  onAssistantDelta: (delta: string) => void;
  renderReply: (replyOutput: string, hasPrintedProgress: boolean) => Promise<void>;
  streamedText: () => string;
} {
  let assistantStreamStarted = false;
  let assistantStreamText = "";
  let assistantLineBuffer = "";

  const flushAssistantLine = (line: string): void => {
    if (!assistantStreamStarted) {
      printOutput(`• ${line}`);
      assistantStreamStarted = true;
      return;
    }
    printOutput(`  ${line}`);
  };

  const flushBufferedLines = (): void => {
    if (assistantLineBuffer.length === 0) return;
    flushAssistantLine(assistantLineBuffer);
    assistantLineBuffer = "";
  };

  return {
    onAssistantDelta: (delta) => {
      if (delta.length === 0) return;
      assistantStreamText += delta;
      assistantLineBuffer += delta;
      while (true) {
        const newlineIndex = assistantLineBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = assistantLineBuffer.slice(0, newlineIndex);
        assistantLineBuffer = assistantLineBuffer.slice(newlineIndex + 1);
        flushAssistantLine(line);
      }
    },
    renderReply: async (replyOutput, hasPrintedProgress) => {
      printOutput("");
      if (hasPrintedProgress) printOutput("");
      const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
      flushBufferedLines();
      const missingTail = missingAssistantStreamTail(assistantStreamText, replyOutput);
      if (missingTail.length > 0) {
        assistantLineBuffer += missingTail;
        while (true) {
          const newlineIndex = assistantLineBuffer.indexOf("\n");
          if (newlineIndex === -1) break;
          const line = assistantLineBuffer.slice(0, newlineIndex);
          assistantLineBuffer = assistantLineBuffer.slice(newlineIndex + 1);
          flushAssistantLine(line);
        }
        flushBufferedLines();
      } else if (!assistantStreamStarted) {
        await streamText(formatAssistantReplyOutput(replyOutput, wrapWidth));
      }
    },
    streamedText: () => assistantStreamText,
  };
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client: Client,
  options?: { resourceId?: ResourceId; workspace?: string; verifyScope?: VerifyScope },
): Promise<boolean> {
  const userMsg = createMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${prompt}`);
    const assistantRenderer = createAssistantStreamRenderer();
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
        verifyScope: options?.verifyScope,
        ...createWorkspaceSpecifier(options?.workspace),
      },
      {
        onEvent: (event) => {
          switch (event.type) {
            case "text-delta":
              assistantRenderer.onAssistantDelta(event.text);
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
              const { header, lines } = formatChecklist(event);
              printDim(`• ${header}`);
              for (const line of lines) printIndentedDim(line);
              hasPrintedToolProgress = true;
              break;
            }
            case "tool-result": {
              const guardBlocked =
                event.isError === true &&
                (event.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || event.error?.category === "guard-blocked");
              if (guardBlocked) toolOutput.delete(event.toolCallId);
              break;
            }
          }
        },
      },
    );

    if (reply.error) {
      printError(reply.error);
    } else {
      await assistantRenderer.renderReply(reply.output, hasPrintedToolProgress);
    }
    const assistantMessage = createMessage("assistant", reply.output);
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
