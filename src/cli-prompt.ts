import { stdout as output } from "node:process";
import { formatToolHeader } from "./agent-output";
import { createWorkspaceSpecifier } from "./api";
import type { Message } from "./chat-message";
import { createProgressTracker } from "./chat-progress";
import { formatAssistantReplyOutput, formatProgressOutput } from "./cli-format";
import { mergeAssistantStreamOutput, missingAssistantStreamTail } from "./cli-stream-output";
import { type Client, createClient } from "./client";
import { createDebugLogger } from "./debug-flags";
import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import type { Session } from "./session-types";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { parseToolProgressLine } from "./tool-progress";
import { mergeToolOutputHeader, shouldSuppressEmptyToolProgressRow } from "./tool-summary-format";
import { printDim, printError, printOutput, streamText } from "./ui";

const debug = createDebugLogger({
  scope: "cli",
  sink: (line) => printDim(line),
});

function nowIso(): string {
  return new Date().toISOString();
}

export function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${createId()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

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
  onToolCall: (entry: { toolCallId: string; toolName: string; args: unknown }) => void;
  onToolOutput: (entry: { toolCallId: string; toolName: string; content: string }) => void;
  onToolResult: (entry: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    errorCode?: string;
    errorDetail?: { category?: string; [key: string]: unknown };
  }) => void;
} {
  let printedProgress = false;
  const toolSnapshotByCallId = new Map<string, string>();
  const toolLineWidthByCallId = new Map<string, number>();
  const toolBulletPrintedByCallId = new Map<string, boolean>();
  const pendingToolHeaderByCallId = new Map<string, string>();
  const toolHasBodyOutputByCallId = new Set<string>();

  const ensureToolHeaderPrinted = (toolCallId: string): void => {
    if (toolBulletPrintedByCallId.get(toolCallId)) return;
    const header = pendingToolHeaderByCallId.get(toolCallId);
    if (!header) return;
    toolSnapshotByCallId.set(toolCallId, header);
    printOutput(formatProgressOutput(header, { bullet: true }));
    toolBulletPrintedByCallId.set(toolCallId, true);
    pendingToolHeaderByCallId.delete(toolCallId);
    printedProgress = true;
  };

  const lineNumberWidthForMessage = (message: string): number => {
    return message.split("\n").reduce((max, line) => {
      const parsed = parseToolProgressLine(line);
      if (parsed.kind === "numberedDiff" || parsed.kind === "numberedContext") {
        return Math.max(max, parsed.lineNumber.length);
      }
      return max;
    }, 0);
  };

  const deltaForToolUpdate = (entry: { message: string; toolCallId?: string }): string => {
    const toolCallId = entry.toolCallId?.trim();
    if (!toolCallId) return entry.message;
    const snapshotWidth = lineNumberWidthForMessage(entry.message);
    if (snapshotWidth > 0)
      toolLineWidthByCallId.set(toolCallId, Math.max(toolLineWidthByCallId.get(toolCallId) ?? 0, snapshotWidth));
    const previous = toolSnapshotByCallId.get(toolCallId);
    toolSnapshotByCallId.set(toolCallId, entry.message);
    if (!previous) return entry.message;
    const current = entry.message.trimEnd();
    const before = previous.trimEnd();
    if (current.length === 0 || current === before) return "";
    if (current.startsWith(`${before}\n`)) return current.slice(before.length + 1);
    return current;
  };

  return {
    hasPrintedProgress: () => printedProgress,
    onToolCall: (entry) => {
      const args = typeof entry.args === "object" && entry.args !== null ? (entry.args as Record<string, unknown>) : {};
      const header = formatToolHeader(entry.toolName, args);
      pendingToolHeaderByCallId.set(entry.toolCallId, header);
    },
    onToolOutput: (entry) => {
      debug.log("tool-stream", {
        id: entry.toolCallId,
        tool: entry.toolName,
        content: entry.content,
      });
      const summaryHeader = mergeToolOutputHeader(
        pendingToolHeaderByCallId.get(entry.toolCallId) ?? "",
        entry.toolName,
        entry.content,
      );
      if (summaryHeader && !toolBulletPrintedByCallId.get(entry.toolCallId)) {
        pendingToolHeaderByCallId.set(entry.toolCallId, summaryHeader);
        ensureToolHeaderPrinted(entry.toolCallId);
        toolHasBodyOutputByCallId.add(entry.toolCallId);
        return;
      }
      toolHasBodyOutputByCallId.add(entry.toolCallId);
      ensureToolHeaderPrinted(entry.toolCallId);
      const delta = deltaForToolUpdate({ message: entry.content, toolCallId: entry.toolCallId });
      debug.log("tool-stream-delta", { content: delta });
      if (!delta) return;
      const lineNumberWidth = toolLineWidthByCallId.get(entry.toolCallId);
      const includeBullet = !toolBulletPrintedByCallId.get(entry.toolCallId);
      printOutput(formatProgressOutput(delta, { lineNumberWidth, bullet: includeBullet }));
      toolBulletPrintedByCallId.set(entry.toolCallId, true);
      printedProgress = true;
    },
    onToolResult: (entry) => {
      const guardBlocked =
        entry.isError === true &&
        (entry.errorCode === LIFECYCLE_ERROR_CODES.guardBlocked || entry.errorDetail?.category === "guard-blocked");
      if (guardBlocked) {
        pendingToolHeaderByCallId.delete(entry.toolCallId);
        return;
      }
      if (!toolHasBodyOutputByCallId.has(entry.toolCallId) && shouldSuppressEmptyToolProgressRow(entry.toolName)) {
        pendingToolHeaderByCallId.delete(entry.toolCallId);
        return;
      }
      ensureToolHeaderPrinted(entry.toolCallId);
    },
  };
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client: Client = createClient(),
  options?: { resourceId?: string; workspace?: string },
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
      onToolCall: toolRenderer.onToolCall,
      onToolOutput: toolRenderer.onToolOutput,
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
    session.messages.push(newMessage("assistant", mergedOutput));
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
