import { stdout as output } from "node:process";
import { createWorkspaceSpecifier } from "./api";
import { newMessage } from "./chat-session";
import { formatAssistantReplyOutput } from "./cli-format";
import { missingAssistantStreamTail } from "./cli-stream-output";
import type { Client } from "./client";
import { nowIso } from "./datetime";
import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { createToolOutputState } from "./tool-output-content";
import { printError, printOutput, streamText } from "./ui";

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== "New Session") return;
  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
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
  options?: { resourceId?: ResourceId; workspace?: string },
): Promise<boolean> {
  const userMsg = newMessage("user", prompt);
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
              const previous = snapshotByCallId.get(event.toolCallId);
              snapshotByCallId.set(event.toolCallId, update.rendered);
              if (previous) {
                const current = update.rendered.trimEnd();
                const before = previous.trimEnd();
                if (current === before) break;
                if (current.startsWith(`${before}\n`)) {
                  const delta = current.slice(before.length + 1);
                  const lines = delta.split("\n");
                  printOutput(lines.map((line) => (line.length > 0 ? `  ${line}` : "")).join("\n"));
                  hasPrintedToolProgress = true;
                  break;
                }
              }
              const lines = update.rendered.split("\n");
              printOutput(
                lines.map((line, i) => (i === 0 ? `• ${line}` : line.length > 0 ? `  ${line}` : "")).join("\n"),
              );
              hasPrintedToolProgress = true;
              break;
            }
            case "tool-result": {
              const guardBlocked =
                event.isError === true &&
                (event.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked ||
                  event.errorDetail?.category === "guard-blocked");
              if (guardBlocked) toolOutput.delete(event.toolCallId);
              break;
            }
          }
        },
      },
    );

    if (reply.error) {
      printError(`Error: ${reply.error}`);
    } else {
      await assistantRenderer.renderReply(reply.output, hasPrintedToolProgress);
    }
    const assistantMessage = newMessage("assistant", reply.output);
    session.messages.push(
      (reply.toolCalls?.length ?? 0) > 0 ? { ...assistantMessage, kind: "tool_payload" } : assistantMessage,
    );
    session.model = reply.model;
    session.updatedAt = nowIso();
    return true;
  } catch (error) {
    if (!(error instanceof Error)) printError(USER_ERROR_MESSAGES.requestFailed);
    else printError(formatPromptError(error.message));
    session.updatedAt = nowIso();
    return false;
  }
}
