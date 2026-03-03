#!/usr/bin/env bun
import { stdout as output } from "node:process";
import { formatToolHeader } from "./agent-output";
import { createWorkspaceSpecifier } from "./api";
import { appConfig } from "./app-config";
import type { Message } from "./chat-message";
import { createProgressTracker } from "./chat-progress";
import { runInkChat } from "./chat-ui";
import { commands, isTopLevelHelpCommand, isTopLevelVersionCommand, usage } from "./cli-commands";
import { formatAssistantReplyOutput, formatProgressOutput } from "./cli-format";
import { formatLocalServerReadyMessage, resolveChatApiUrl, shouldAutoStartLocalServerForChat } from "./cli-server";
import { mergeAssistantStreamOutput, missingAssistantStreamTail } from "./cli-stream-output";
import { resolveCliVersion } from "./cli-version";
import { createClient } from "./client";
import { createDebugLogger } from "./debug-flags";
import { formatPromptError, USER_ERROR_MESSAGES } from "./error-messages";
import { buildFileContext } from "./file-context";
import { ensureLocalServer } from "./server-daemon";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import type { Session, SessionStore } from "./session-types";
import { createId } from "./short-id";
import { createSession, readStore, writeStore } from "./storage";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { parseToolProgressLine } from "./tool-progress";
import { mergeToolOutputHeader, shouldSuppressEmptyToolProgressRow } from "./tool-summary-format";
import { clearScreen, printDim, printError, printOutput, streamText } from "./ui";

const debug = createDebugLogger({
  scope: "cli",
  sink: (line) => printDim(line),
});

const CLI_VERSION = resolveCliVersion();

export const FALLBACK_MODEL = "gpt-5-mini";

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

export function formatResumeCommand(sessionId: string): string {
  return `acolyte resume ${sessionId}`;
}


export async function handlePrompt(
  prompt: string,
  session: Session,
  client = createClient(),
  options?: { resourceId?: string; workspace?: string },
): Promise<boolean> {
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${prompt}`);
    let hasPrintedProgress = false;
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
      hasPrintedProgress = true;
    };
    const lineNumberWidthForMessage = (message: string): number => {
      return message.split("\n").reduce((max, line) => {
        const parsed = parseToolProgressLine(line);
        if (parsed.kind === "numberedDiff" || parsed.kind === "numberedContext")
          return Math.max(max, parsed.lineNumber.length);
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
    const progressTracker = createProgressTracker({
      onStatus: () => {},
      onAssistant: (delta) => {
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
      onToolCall: (entry) => {
        const header = formatToolHeader(entry.toolName, entry.args);
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
        hasPrintedProgress = true;
      },
      onToolResult: (entry) => {
        const guardBlocked =
          entry.isError &&
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

    printOutput("");
    if (hasPrintedProgress) printOutput("");
    const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
    if (assistantLineBuffer.length > 0) {
      flushAssistantLine(assistantLineBuffer);
      assistantLineBuffer = "";
    }
    const missingTail = missingAssistantStreamTail(assistantStreamText, reply.output);
    if (missingTail.length > 0) {
      assistantLineBuffer += missingTail;
      while (true) {
        const newlineIndex = assistantLineBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = assistantLineBuffer.slice(0, newlineIndex);
        assistantLineBuffer = assistantLineBuffer.slice(newlineIndex + 1);
        flushAssistantLine(line);
      }
      if (assistantLineBuffer.length > 0) {
        flushAssistantLine(assistantLineBuffer);
        assistantLineBuffer = "";
      }
    } else if (!assistantStreamStarted) {
      await streamText(formatAssistantReplyOutput(reply.output, wrapWidth));
    }
    const mergedOutput = mergeAssistantStreamOutput(assistantStreamText, reply.output);
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

export async function attachFileToSession(session: Session, filePath: string): Promise<void> {
  const context = await buildFileContext(filePath);
  session.messages.push(newMessage("system", context));
  session.updatedAt = nowIso();
}

type ResumeTarget =
  | { kind: "ok"; session: Session }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] };

function resolveResumeTarget(
  store: SessionStore,
  options: { resumeLatest: boolean; resumePrefix?: string },
): ResumeTarget | null {
  if (options.resumePrefix) {
    const matches = store.sessions.filter((item) => item.id.startsWith(options.resumePrefix ?? ""));
    if (matches.length === 0) return { kind: "not_found", prefix: options.resumePrefix };
    if (matches.length > 1) return { kind: "ambiguous", prefix: options.resumePrefix, matches };
    return { kind: "ok", session: matches[0] };
  }

  if (!options.resumeLatest) return null;

  const active = store.activeSessionId ? store.sessions.find((item) => item.id === store.activeSessionId) : undefined;
  if (active) return { kind: "ok", session: active };
  if (store.sessions.length > 0) {
    const latest = store.sessions[0];
    if (latest) return { kind: "ok", session: latest };
  }
  return null;
}

export async function chatModeWithOptions(options: { resumeLatest: boolean; resumePrefix?: string }): Promise<void> {
  const store = await readStore();
  const defaultModel = appConfig.model ?? FALLBACK_MODEL;
  const resolved = resolveResumeTarget(store, options);
  if (resolved?.kind === "not_found") {
    printError(`No session found for prefix: ${resolved.prefix}`);
    process.exitCode = 1;
    return;
  }
  if (resolved?.kind === "ambiguous") {
    const sample = resolved.matches.slice(0, 6).map((item) => item.id);
    printError(`Ambiguous prefix: ${resolved.prefix}`);
    printDim(`Matches: ${sample.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const isResumed = resolved?.kind === "ok";
  const session = isResumed ? resolved.session : createSession(defaultModel);
  if (!isResumed) {
    // Start a fresh chat session by default to avoid cross-session transcript/context bleed.
    store.sessions.unshift(session);
  }
  store.activeSessionId = session.id;
  const lock = acquireSessionLock(session.id);
  if (!lock.ok) {
    printError(`Session is already open in another process (pid ${lock.ownerPid}).`);
    printDim(`Use: ${formatResumeCommand(session.id)}`);
    process.exitCode = 1;
    return;
  }
  let apiUrl = resolveChatApiUrl(appConfig.server.apiUrl, appConfig.server.port);
  if (shouldAutoStartLocalServerForChat(appConfig.server.apiUrl)) {
    const daemon = await ensureLocalServer({
      apiUrl,
      port: appConfig.server.port,
      apiKey: appConfig.server.apiKey,
      serverEntry: `${import.meta.dir}/server.ts`,
    });
    apiUrl = daemon.apiUrl;
    printDim(formatLocalServerReadyMessage(daemon));
  }
  const client = createClient({ apiUrl });
  const persist = async (): Promise<void> => {
    await writeStore(store);
  };

  try {
    if (output.isTTY) clearScreen();
    await runInkChat({
      client,
      session,
      store,
      persist,
      version: CLI_VERSION,
      useMemory: isResumed,
    });
    if (output.isTTY) clearScreen();
    const resumeId = store.activeSessionId ?? session.id;
    printDim(`Resume with: ${formatResumeCommand(resumeId)}`);
  } finally {
    releaseSessionLock(session.id);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (isTopLevelHelpCommand(command)) {
    usage(CLI_VERSION);
    return;
  }
  if (isTopLevelVersionCommand(command)) {
    printOutput(CLI_VERSION);
    return;
  }

  if (!command) {
    await chatModeWithOptions({ resumeLatest: false });
    return;
  }

  const handler = commands[command];
  if (handler) {
    await handler(args);
    return;
  }

  usage(CLI_VERSION);
  process.exitCode = 1;
}

if (import.meta.main) await main();
