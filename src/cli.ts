#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { stdout as output } from "node:process";
import { formatToolHeader } from "./agent";
import { createWorkspaceSpecifier } from "./api";
import { appConfig } from "./app-config";
import { createProgressTracker } from "./chat-progress";
import { runInkChat } from "./chat-ui";
import { commands, isTopLevelHelpCommand, isTopLevelVersionCommand, usage } from "./cli-commands";
import {
  displayPromptForOutput,
  formatAssistantReplyOutput,
  formatProgressEventOutput,
  formatPromptError,
} from "./cli-format";
import { createClient } from "./client";
import { createDebugLogger } from "./debug-flags";
import { buildFileContext } from "./file-context";
import { ensureLocalServer } from "./server-daemon";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import { createId } from "./short-id";
import { normalizeToolFileSummaryHeader, shouldSuppressEmptyToolProgressRow } from "./tool-summary-format";
import { createSession, readStore, writeStore } from "./storage";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { parseToolProgressLine } from "./tool-progress";
import type { Message, Session, SessionStore } from "./types";
import { clearScreen, printDim, printError, printOutput, streamText } from "./ui";

const debug = createDebugLogger({
  scope: "cli",
  sink: (line) => printDim(line),
});

export function extractVersionFromPackageJsonText(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim().length > 0 ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function resolveCliVersion(): string {
  if (process.env.npm_package_version && process.env.npm_package_version.trim().length > 0)
    return process.env.npm_package_version.trim();
  const candidates = [`${process.cwd()}/package.json`, `${import.meta.dir}/../package.json`];
  for (const path of candidates) {
    try {
      const version = extractVersionFromPackageJsonText(readFileSync(path, "utf8"));
      if (version) return version;
    } catch {
      // Try next candidate.
    }
  }
  return "dev";
}

const CLI_VERSION = resolveCliVersion();

export const FALLBACK_MODEL = "gpt-5-mini";
const DEFAULT_LOCAL_API_HOST = "127.0.0.1";
const DEFAULT_LOCAL_API_PORT = 6767;

function nowIso(): string {
  return new Date().toISOString();
}

export function resolveChatApiUrl(configuredApiUrl: string | undefined, port = DEFAULT_LOCAL_API_PORT): string {
  const trimmed = configuredApiUrl?.trim();
  if (trimmed) return trimmed;
  return `http://${DEFAULT_LOCAL_API_HOST}:${port}`;
}

function isLocalLoopbackApiUrl(apiUrl: string): boolean {
  try {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function shouldAutoStartLocalServerForChat(configuredApiUrl: string | undefined): boolean {
  const trimmed = configuredApiUrl?.trim();
  if (!trimmed) return true;
  return isLocalLoopbackApiUrl(trimmed);
}

export function resolveLocalDaemonApiUrl(configuredApiUrl: string | undefined, port = DEFAULT_LOCAL_API_PORT): string {
  if (shouldAutoStartLocalServerForChat(configuredApiUrl)) return resolveChatApiUrl(configuredApiUrl, port);
  return resolveChatApiUrl(undefined, port);
}

export function formatLocalServerReadyMessage(result: { apiUrl: string; started: boolean; managed: boolean }): string {
  if (result.started) return `Started local server at ${result.apiUrl}`;
  if (result.managed) return `Using local server at ${result.apiUrl}`;
  return `Using unmanaged local server at ${result.apiUrl} (started outside Acolyte).`;
}

export function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${createId()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

const CHAT_COMMANDS = ["?", "/exit"];

const COMMAND_ALIASES: Record<string, string> = {};

export function resolveCommandAlias(command: string): string {
  return COMMAND_ALIASES[command] ?? command;
}

function allKnownCommands(): string[] {
  return [...CHAT_COMMANDS, ...Object.keys(COMMAND_ALIASES)];
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export function suggestCommand(input: string): string | null {
  return suggestCommands(input, 1)[0] ?? null;
}

export function suggestCommands(input: string, max = 3): string[] {
  const normalized = input.trim();
  if (!normalized.startsWith("/") && !normalized.startsWith("?")) return [];
  const commands = allKnownCommands();
  const prefixMatches: string[] = [];
  for (const command of commands) {
    if (command.startsWith(normalized)) prefixMatches.push(command);
  }
  if (prefixMatches.length > 0) return prefixMatches.slice(0, max);

  const scored: Array<{ command: string; score: number }> = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const command of commands) {
    const score = editDistance(normalized, command);
    bestScore = Math.min(bestScore, score);
    scored.push({ command, score });
  }
  if (!Number.isFinite(bestScore) || bestScore > 3) return [];
  return scored
    .filter((row) => row.score === bestScore)
    .slice(0, max)
    .map((row) => row.command);
}

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== "New Session") return;

  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) session.title = title;
}

export function formatResumeCommand(sessionId: string): string {
  return `acolyte resume ${sessionId}`;
}

export function missingAssistantStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

export function mergeAssistantStreamOutput(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput.length === 0) return streamed;
  if (finalOutput === streamed) return finalOutput;
  if (finalOutput.startsWith(streamed)) return finalOutput;
  if (streamed.startsWith(finalOutput)) return streamed;
  const maxOverlap = Math.min(streamed.length, finalOutput.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (streamed.endsWith(finalOutput.slice(0, overlap))) return streamed + finalOutput.slice(overlap);
  }
  return streamed;
}

export async function handlePrompt(
  prompt: string,
  session: Session,
  client = createClient(),
  options?: { resourceId?: string; workspace?: string; skipAutoVerify?: boolean },
): Promise<boolean> {
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${displayPromptForOutput(prompt)}`);
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
      printOutput(formatProgressEventOutput(header, { bullet: true }));
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
        const summaryHeader = normalizeToolFileSummaryHeader(
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
        printOutput(formatProgressEventOutput(delta, { lineNumberWidth, bullet: includeBullet }));
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
        skipAutoVerify: options?.skipAutoVerify,
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
    printError(formatPromptError(error));
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
