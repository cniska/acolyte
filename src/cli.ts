#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { stdout as output } from "node:process";
import { z } from "zod";
import { formatToolHeader } from "./agent";
import { runShellCommand } from "./agent-tools";
import { createWorkspaceSpecifier } from "./api";
import { appConfig } from "./app-config";
import { formatColumns, formatRelativeTime } from "./chat-formatters";
import { createProgressTracker } from "./chat-progress";
import { runInkChat } from "./chat-ui";
import {
  displayPromptForOutput,
  formatAssistantReplyOutput,
  formatForTool,
  formatProgressEventOutput,
  parseRunExitCode,
  showToolResult,
  truncateText,
} from "./cli-format";
import { toolMode } from "./cli-tool-mode";
import { createClient } from "./client";
import { readConfig, readConfigForScope, readResolvedConfigSync, setConfigValue, unsetConfigValue } from "./config";
import { buildFileContext } from "./file-context";
import { addMemory, listMemories } from "./memory";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import { createId } from "./short-id";
import { formatStatusOutput as formatStatusOutputShared } from "./status-format";
import { createSession, readStore, writeStore } from "./storage";
import { parseToolProgressLine } from "./tool-progress";
import type { Message, Session, SessionStore } from "./types";
import { clearScreen, formatCliTitle, printDim, printError, printOutput, streamText } from "./ui";

const FALLBACK_MODEL = "gpt-5-mini";
export function extractVersionFromPackageJsonText(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim().length > 0 ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function resolveCliVersion(): string {
  if (process.env.npm_package_version && process.env.npm_package_version.trim().length > 0) {
    return process.env.npm_package_version.trim();
  }
  const candidates = [`${process.cwd()}/package.json`, `${import.meta.dir}/../package.json`];
  for (const path of candidates) {
    try {
      const version = extractVersionFromPackageJsonText(readFileSync(path, "utf8"));
      if (version) {
        return version;
      }
    } catch {
      // Try next candidate.
    }
  }
  return "dev";
}

const CLI_VERSION = resolveCliVersion();
const RUN_MODE_SYSTEM_PROMPT =
  "Run mode: answer concisely and directly (prefer <=5 lines). Avoid option menus unless the user explicitly asks for options.";
const runArgsSchema = z.object({
  files: z.array(z.string().min(1)),
  prompt: z.string(),
  verify: z.boolean(),
});
const dogfoodArgsSchema = z.object({
  files: z.array(z.string().min(1)),
  prompt: z.string(),
  verify: z.boolean(),
});
function usage(): void {
  const commands = buildUsageCommandRows();
  const options = buildUsageOptionRows();
  const sharedPad =
    Math.max(
      commands.reduce((max, row) => Math.max(max, row.command.length), 0),
      options.reduce((max, row) => Math.max(max, row.option.length), 0),
    ) + 2;
  const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
  const whiteBold = (text: string): string => `\x1b[1m\x1b[37m${text}\x1b[39m\x1b[22m`;

  printOutput("");
  printOutput(formatCliTitle(CLI_VERSION));
  printOutput("");
  printOutput(whiteBold("Usage"));
  printOutput("  acolyte");
  printOutput("  acolyte <COMMAND> [ARGS]");
  printOutput("");

  printOutput(whiteBold("Commands"));
  for (const row of commands) {
    printOutput(`  ${row.command.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printOutput("");

  printOutput(whiteBold("Options"));
  for (const row of options) {
    printOutput(`  ${row.option.padEnd(sharedPad)}${dim(row.description)}`);
  }
  printOutput("");
}

export function buildUsageCommandRows(): Array<{ command: string; description: string }> {
  return [
    { command: "resume [id-prefix]", description: "resume previous session" },
    { command: "run <prompt>", description: "run a single prompt" },
    { command: "history", description: "show recent sessions" },
    { command: "serve", description: "start the API server" },
    { command: "status", description: "show server status" },
    { command: "memory", description: "manage memory notes" },
    { command: "config", description: "manage local CLI config" },
  ];
}

export function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

export function buildUsageOptionRows(): Array<{ option: string; description: string }> {
  return [
    { option: "-h, --help", description: "print help" },
    { option: "-V, --version", description: "print version" },
  ];
}

export function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
}

function nowIso(): string {
  return new Date().toISOString();
}

function newMessage(role: Message["role"], content: string): Message {
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
  if (!normalized.startsWith("/") && !normalized.startsWith("?")) {
    return [];
  }
  const commands = allKnownCommands();
  const prefixMatches: string[] = [];
  for (const command of commands) {
    if (command.startsWith(normalized)) {
      prefixMatches.push(command);
    }
  }
  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, max);
  }

  const scored: Array<{ command: string; score: number }> = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const command of commands) {
    const score = editDistance(normalized, command);
    bestScore = Math.min(bestScore, score);
    scored.push({ command, score });
  }
  if (!Number.isFinite(bestScore) || bestScore > 3) {
    return [];
  }
  return scored
    .filter((row) => row.score === bestScore)
    .slice(0, max)
    .map((row) => row.command);
}

function listSessions(store: SessionStore): void {
  if (store.sessions.length === 0) {
    printDim("No saved sessions.");
    return;
  }

  const rows = store.sessions
    .slice(0, 20)
    .map((session) => [session.id, truncateText(session.title, 60), formatRelativeTime(session.updatedAt)]);
  for (const line of formatColumns(rows)) {
    printDim(line);
  }
}

function printMemoryRows(rows: Awaited<ReturnType<typeof listMemories>>): void {
  if (rows.length === 0) {
    printDim("No memories saved.");
    return;
  }

  const formatted = rows
    .slice(0, 50)
    .map((row) => [row.id, truncateText(row.content, 80), formatRelativeTime(row.createdAt)]);
  for (const line of formatColumns(formatted)) {
    printDim(line);
  }
}

export function formatStatusOutput(status: Record<string, string>): string {
  return formatStatusOutputShared(status);
}

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== "New Session") {
    return;
  }

  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) {
    session.title = title;
  }
}

export function runResourceId(sessionId: string): string {
  return `run-${sessionId.replace(/^sess_/, "").slice(0, 24)}`;
}

export function formatPromptError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Request failed. Retry and check server logs if it keeps failing.";
  }
  const message = error.message.trim();
  const lower = message.toLowerCase();
  if (lower.includes("insufficient_quota") || lower.includes("quota exceeded") || lower.includes("quota")) {
    return "Provider quota exceeded. Add billing/credits or switch model/provider.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Server request timed out. Retry or reduce request scope.";
  }
  if (lower.includes("shell command execution is disabled in read mode")) {
    return "Write action blocked in read mode. Run /permissions write and retry.";
  }
  if (
    lower.includes("server unavailable") ||
    lower.includes("connection refused") ||
    lower.includes("socket connection was closed unexpectedly")
  ) {
    return "Server unavailable. Start the server and retry.";
  }
  if (lower.includes("remote server error")) {
    return message;
  }
  return message || "Request failed. Retry and check server logs if it keeps failing.";
}

async function handlePrompt(
  prompt: string,
  session: Session,
  client = createClient(),
  options?: { resourceId?: string; workspace?: string },
): Promise<boolean> {
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  try {
    printOutput(`❯ ${displayPromptForOutput(prompt)}`);
    let hasPrintedProgress = false;
    let assistantStreamStarted = false;
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
      if (!toolCallId) {
        return entry.message;
      }
      const snapshotWidth = lineNumberWidthForMessage(entry.message);
      if (snapshotWidth > 0) {
        toolLineWidthByCallId.set(toolCallId, Math.max(toolLineWidthByCallId.get(toolCallId) ?? 0, snapshotWidth));
      }
      const previous = toolSnapshotByCallId.get(toolCallId);
      toolSnapshotByCallId.set(toolCallId, entry.message);
      if (!previous) {
        return entry.message;
      }
      const current = entry.message.trimEnd();
      const before = previous.trimEnd();
      if (current.length === 0 || current === before) {
        return "";
      }
      if (current.startsWith(`${before}\n`)) {
        return current.slice(before.length + 1);
      }
      return current;
    };
    const progressTracker = createProgressTracker({
      onStatus: () => {},
      onAssistant: (delta) => {
        if (delta.length === 0) {
          return;
        }
        assistantLineBuffer += delta;
        while (true) {
          const newlineIndex = assistantLineBuffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }
          const line = assistantLineBuffer.slice(0, newlineIndex);
          assistantLineBuffer = assistantLineBuffer.slice(newlineIndex + 1);
          flushAssistantLine(line);
        }
      },
      onToolCall: (entry) => {
        const header = formatToolHeader(entry.toolName, entry.args);
        toolSnapshotByCallId.set(entry.toolCallId, header);
        printOutput(formatProgressEventOutput(header, { bullet: true }));
        toolBulletPrintedByCallId.set(entry.toolCallId, true);
        hasPrintedProgress = true;
      },
      onToolOutput: (entry) => {
        const delta = deltaForToolUpdate({ message: entry.content, toolCallId: entry.toolCallId });
        if (!delta) {
          return;
        }
        const lineNumberWidth = toolLineWidthByCallId.get(entry.toolCallId);
        const includeBullet = !toolBulletPrintedByCallId.get(entry.toolCallId);
        printOutput(formatProgressEventOutput(delta, { lineNumberWidth, bullet: includeBullet }));
        toolBulletPrintedByCallId.set(entry.toolCallId, true);
        hasPrintedProgress = true;
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
    if (hasPrintedProgress) {
      printOutput("");
    }
    const wrapWidth = Math.max(24, (output.columns ?? 120) - 4);
    if (assistantLineBuffer.length > 0) {
      flushAssistantLine(assistantLineBuffer);
      assistantLineBuffer = "";
    }
    if (!assistantStreamStarted) {
      await streamText(formatAssistantReplyOutput(reply.output, wrapWidth));
    }
    session.messages.push(newMessage("assistant", reply.output));
    session.model = reply.model;
    session.updatedAt = nowIso();
    return true;
  } catch (error) {
    printError(formatPromptError(error));
    session.updatedAt = nowIso();
    return false;
  }
}

async function attachFileToSession(session: Session, filePath: string): Promise<void> {
  const context = await buildFileContext(filePath);
  session.messages.push(newMessage("system", context));
  session.updatedAt = nowIso();
}

function parseRunArgs(args: string[]): { files: string[]; prompt: string; verify: boolean; workspace?: string } {
  const files: string[] = [];
  const promptTokens: string[] = [];
  let verify = false;
  let workspace: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("--file requires a path");
      }
      files.push(next);
      i += 1;
      continue;
    }
    if (args[i] === "--workspace") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("--workspace requires a path");
      }
      workspace = next;
      i += 1;
      continue;
    }
    if (args[i] === "--verify") {
      verify = true;
      continue;
    }

    promptTokens.push(args[i]);
  }

  return { ...runArgsSchema.parse({ files, prompt: promptTokens.join(" ").trim(), verify }), workspace };
}

export function parseDogfoodArgs(args: string[]): { files: string[]; prompt: string; verify: boolean } {
  const files: string[] = [];
  const promptTokens: string[] = [];
  let verify = true;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("--file requires a path");
      }
      files.push(next);
      i += 1;
      continue;
    }
    if (args[i] === "--no-verify") {
      verify = false;
      continue;
    }
    if (args[i] === "--verify") {
      verify = true;
      continue;
    }

    promptTokens.push(args[i]);
  }

  return dogfoodArgsSchema.parse({ files, prompt: promptTokens.join(" ").trim(), verify });
}

export function formatResumeCommand(sessionId: string): string {
  return `acolyte resume ${sessionId}`;
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
    if (matches.length === 0) {
      return { kind: "not_found", prefix: options.resumePrefix };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", prefix: options.resumePrefix, matches };
    }
    return { kind: "ok", session: matches[0] };
  }

  if (!options.resumeLatest) {
    return null;
  }

  const active = store.activeSessionId ? store.sessions.find((item) => item.id === store.activeSessionId) : undefined;
  if (active) {
    return { kind: "ok", session: active };
  }
  if (store.sessions.length > 0) {
    const latest = store.sessions[0];
    if (latest) {
      return { kind: "ok", session: latest };
    }
  }
  return null;
}

async function chatModeWithOptions(options: { resumeLatest: boolean; resumePrefix?: string }): Promise<void> {
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
  const client = createClient({
    apiUrl: appConfig.server.apiUrl,
  });
  const persist = async (): Promise<void> => {
    await writeStore(store);
  };

  try {
    if (output.isTTY) {
      clearScreen();
    }
    await runInkChat({
      client,
      session,
      store,
      persist,
      version: CLI_VERSION,
      useMemory: isResumed,
    });
    if (output.isTTY) {
      clearScreen();
    }
    const resumeId = store.activeSessionId ?? session.id;
    printDim(`Resume with: ${formatResumeCommand(resumeId)}`);
  } finally {
    releaseSessionLock(session.id);
  }
}

async function runMode(args: string[]): Promise<void> {
  let parsed: { files: string[]; prompt: string; verify: boolean; workspace?: string };
  try {
    parsed = parseRunArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid run args";
    printError(message);
    process.exitCode = 1;
    return;
  }

  const prompt = parsed.prompt;
  if (!prompt) {
    printError("Usage: acolyte run [--file <path>] [--workspace <path>] [--verify] <prompt>");
    process.exitCode = 1;
    return;
  }

  const defaultModel = appConfig.model ?? FALLBACK_MODEL;
  const resolvedConfig = readResolvedConfigSync();
  const session = createSession(defaultModel);
  session.messages.push(newMessage("system", RUN_MODE_SYSTEM_PROMPT));
  const client = createClient({
    apiUrl: appConfig.server.apiUrl,
    replyTimeoutMs: resolvedConfig.replyTimeoutMs,
  });

  for (const filePath of parsed.files) {
    try {
      await attachFileToSession(session, filePath);
      printDim(`Attached file context from ${filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      printError(message);
      process.exitCode = 1;
      return;
    }
  }

  const success = await handlePrompt(prompt, session, client, {
    resourceId: runResourceId(session.id),
    workspace: parsed.workspace,
  });
  if (!success) {
    process.exitCode = 1;
    return;
  }
  if (parsed.verify) {
    const verifyResult = await runShellCommand(process.cwd(), "bun run verify");
    showToolResult("Run", formatForTool("run", verifyResult), "tool", "bun run verify");
    const verifyExitCode = parseRunExitCode(verifyResult);
    if (verifyExitCode !== null && verifyExitCode !== 0) {
      process.exitCode = 1;
    }
  }
}

async function dogfoodMode(args: string[]): Promise<void> {
  let parsed: { files: string[]; prompt: string; verify: boolean };
  try {
    parsed = parseDogfoodArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid dogfood args";
    printError(message);
    process.exitCode = 1;
    return;
  }
  if (!parsed.prompt) {
    printError("Usage: acolyte dogfood [--file <path>] [--no-verify] <prompt>");
    process.exitCode = 1;
    return;
  }

  const preamble = [
    "Dogfood mode:",
    "- Work in small, verifiable steps.",
    "- Keep response concise and action-focused.",
    "- Return one immediate next action; avoid multi-option menus unless asked.",
    "- If edits are made, verify with bun run verify.",
    "",
  ].join("\n");

  const runArgs = [
    ...parsed.files.flatMap((filePath) => ["--file", filePath]),
    ...(parsed.verify ? ["--verify"] : []),
    `${preamble}${parsed.prompt}`,
  ];
  await runMode(runArgs);
}

async function historyMode(): Promise<void> {
  const store = await readStore();
  listSessions(store);
}

async function serveMode(): Promise<void> {
  await import("./server");
}

async function statusMode(): Promise<void> {
  const client = createClient({
    apiUrl: appConfig.server.apiUrl,
  });
  try {
    const status = await client.status();
    printDim(formatStatusOutput(status));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    process.exitCode = 1;
  }
}

async function memoryMode(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const validScopes = new Set(["all", "user", "project"]);

  if (subcommand === "list" || !subcommand) {
    const scopeRaw = subcommand === "list" ? rest[0] : undefined;
    if (subcommand === "list" && rest.length > 1) {
      printError("Usage: acolyte memory list [all|user|project]");
      process.exitCode = 1;
      return;
    }
    const scope = scopeRaw && validScopes.has(scopeRaw) ? scopeRaw : "all";
    if (scopeRaw && !validScopes.has(scopeRaw)) {
      printError("Usage: acolyte memory list [all|user|project]");
      process.exitCode = 1;
      return;
    }
    const rows = await listMemories({ scope: scope as "all" | "user" | "project" });
    printMemoryRows(rows);
    return;
  }

  if (subcommand === "add") {
    let scope: "user" | "project" = "user";
    const contentParts: string[] = [];
    for (const token of rest) {
      if (token === "--project") {
        scope = "project";
        continue;
      }
      if (token === "--user") {
        scope = "user";
        continue;
      }
      contentParts.push(token);
    }
    const content = contentParts.join(" ").trim();
    if (!content) {
      printError("Usage: acolyte memory add [--user|--project] <memory text>");
      process.exitCode = 1;
      return;
    }
    const entry = await addMemory(content, { scope });
    printDim(`Saved ${scope} memory ${entry.id}.`);
    return;
  }

  printError("Usage: acolyte memory <list|add> [options]");
  process.exitCode = 1;
}

async function configMode(args: string[]): Promise<void> {
  const [subcommandRaw, ...restArgs] = args;
  const isImplicitList = !subcommandRaw || subcommandRaw === "--user" || subcommandRaw === "--project";
  const subcommand = isImplicitList ? "list" : subcommandRaw;
  const listArgs = isImplicitList && subcommandRaw ? [subcommandRaw, ...restArgs] : restArgs;
  const validKeys = [
    "port",
    "model",
    "models",
    "omModel",
    "apiUrl",
    "openaiBaseUrl",
    "anthropicBaseUrl",
    "googleBaseUrl",
    "permissionMode",
    "logFormat",
    "omObservationTokens",
    "omReflectionTokens",
    "contextMaxTokens",
    "maxHistoryMessages",
    "maxMessageTokens",
    "maxAttachmentMessageTokens",
    "maxPinnedMessageTokens",
    "replyTimeoutMs",
  ] as const;
  const valid = new Set<string>(validKeys);
  const parseScopeFlag = (token: string | undefined): "user" | "project" | null => {
    if (token === "--user") {
      return "user";
    }
    if (token === "--project") {
      return "project";
    }
    return null;
  };

  if (subcommand === "list") {
    const scope = parseScopeFlag(listArgs[0]);
    const config = scope ? await readConfigForScope(scope) : await readConfig();
    const maxKey = validKeys.reduce((max, key) => Math.max(max, `${key}:`.length), 0);
    if (scope) {
      printDim(`${"scope:".padEnd(maxKey + 1)} ${scope}`);
    }
    for (const name of validKeys) {
      const value = config[name];
      if (value === undefined || value === "") continue;
      if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          printDim(`${`${name}.${k}:`.padEnd(maxKey + 1)} ${String(v)}`);
        }
      } else {
        printDim(`${`${name}:`.padEnd(maxKey + 1)} ${String(value)}`);
      }
    }
    return;
  }

  if (subcommand === "set") {
    const scope = parseScopeFlag(restArgs[0]);
    const key = scope ? restArgs[1] : restArgs[0];
    const valueParts = scope ? restArgs.slice(2) : restArgs.slice(1);
    if (key === "apiKey") {
      printError("Config apiKey is not supported. Use ACOLYTE_API_KEY in .env instead.");
      process.exitCode = 1;
      return;
    }
    const isDottedKey = key?.includes(".") && valid.has(key.split(".")[0] ?? "");
    if (!key || (!valid.has(key) && !isDottedKey)) {
      printError("Usage: acolyte config set <key> <value>");
      process.exitCode = 1;
      return;
    }

    const value = valueParts.join(" ").trim();
    if (!value) {
      printError("Config value cannot be empty");
      process.exitCode = 1;
      return;
    }

    try {
      await setConfigValue(key, value, { scope: scope ?? "user" });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Invalid value for ${key}`;
      printError(message);
      process.exitCode = 1;
      return;
    }
    printDim(`Saved config ${key} (${scope ?? "user"}).`);
    return;
  }

  if (subcommand === "unset") {
    const scope = parseScopeFlag(restArgs[0]);
    const key = scope ? restArgs[1] : restArgs[0];
    if (key === "apiKey") {
      printError("Config apiKey is not supported. Use ACOLYTE_API_KEY in .env instead.");
      process.exitCode = 1;
      return;
    }
    const isDottedUnsetKey = key?.includes(".") && valid.has(key.split(".")[0] ?? "");
    if (!key || (!valid.has(key) && !isDottedUnsetKey)) {
      printError("Usage: acolyte config unset <key>");
      process.exitCode = 1;
      return;
    }

    await unsetConfigValue(key, { scope: scope ?? "user" });
    printDim(`Removed config ${key} (${scope ?? "user"}).`);
    return;
  }

  printError("Usage: acolyte config <list|set|unset> [options]");
  printDim(`Keys: ${validKeys.join(", ")}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (isTopLevelHelpCommand(command)) {
    usage();
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

  if (command === "resume") {
    if (args.length > 1) {
      printError("Usage: acolyte resume [session-id-prefix]");
      process.exitCode = 1;
      return;
    }
    const resumePrefix = args[0]?.trim() || undefined;
    await chatModeWithOptions({ resumeLatest: true, resumePrefix });
    return;
  }

  if (command === "run") {
    await runMode(args);
    return;
  }

  if (command === "dogfood") {
    await dogfoodMode(args);
    return;
  }

  if (command === "history") {
    await historyMode();
    return;
  }

  if (command === "serve") {
    await serveMode();
    return;
  }

  if (command === "status") {
    await statusMode();
    return;
  }

  if (command === "memory") {
    await memoryMode(args);
    return;
  }

  if (command === "config") {
    await configMode(args);
    return;
  }

  if (command === "tool") {
    await toolMode(args);
    return;
  }

  usage();
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
