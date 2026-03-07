import { stdout as output } from "node:process";
import { createWorkspaceSpecifier } from "./api";
import { createProgressTracker } from "./chat-progress";
import { newMessage } from "./chat-session";
import { formatAssistantReplyOutput, formatToolOutput } from "./cli-format";
import { mergeAssistantStreamOutput, missingAssistantStreamTail } from "./cli-stream-output";
import { type Client, createClient } from "./client";
import { nowIso } from "./datetime";
import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import type { ResourceId } from "./resource-id";
import type { Session } from "./session-contract";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import type { ToolOutput } from "./tool-output-content";
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

function createToolProgressRenderer(): {
  hasPrintedProgress: () => boolean;
  onOutput: (entry: { toolCallId: string; toolName: string; content: ToolOutput }) => void;
  onToolResult: (entry: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    errorCode?: string;
    errorDetail?: { category?: string; [key: string]: unknown };
  }) => void;
} {
  let printedProgress = false;
  const contentByCallId = new Map<string, ToolOutput[]>();
  const snapshotByCallId = new Map<string, string>();

  return {
    hasPrintedProgress: () => printedProgress,
    onOutput: (entry) => {
      const items = contentByCallId.get(entry.toolCallId) ?? [];
      items.push(entry.content);
      contentByCallId.set(entry.toolCallId, items);
      const rendered = formatToolOutput(items);
      const previous = snapshotByCallId.get(entry.toolCallId);
      snapshotByCallId.set(entry.toolCallId, rendered);
      if (previous) {
        const current = rendered.trimEnd();
        const before = previous.trimEnd();
        if (current === before) return;
        if (current.startsWith(`${before}\n`)) {
          const delta = current.slice(before.length + 1);
          const lines = delta.split("\n");
          printOutput(lines.map((line) => (line.length > 0 ? `    ${line}` : "")).join("\n"));
          printedProgress = true;
          return;
        }
      }
      const lines = rendered.split("\n");
      printOutput(lines.map((line, i) => (i === 0 ? `• ${line}` : line.length > 0 ? `  ${line}` : "")).join("\n"));
      printedProgress = true;
    },
    onToolResult: (entry) => {
      const guardBlocked =
        entry.isError === true &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.errorDetail?.category === "guard-blocked");
      if (!guardBlocked) return;
    },
  };
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client: Client = createClient(),
  options?: { resourceId?: ResourceId; workspace?: string },
): Promise<boolean> {
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${prompt}`);
    const assistantRenderer = createAssistantStreamRenderer();
    const toolRenderer = createToolProgressRenderer();
    const progressTracker = createProgressTracker({
      onStatus: () => {},
      onAssistant: assistantRenderer.onAssistantDelta,
      onOutput: toolRenderer.onOutput,
      onToolResult: toolRenderer.onToolResult,
    });
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
          progressTracker.apply(event);
        },
      },
    );

    await assistantRenderer.renderReply(reply.output, toolRenderer.hasPrintedProgress());
    const mergedOutput = mergeAssistantStreamOutput(assistantRenderer.streamedText(), reply.output);
    const assistantMessage = newMessage("assistant", mergedOutput);
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
