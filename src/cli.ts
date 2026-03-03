#!/usr/bin/env bun
import { stdout as output } from "node:process";
import { appConfig } from "./app-config";
import { runInkChat } from "./chat-ui";
import { commands, isTopLevelHelpCommand, isTopLevelVersionCommand, usage } from "./cli-commands";
import { newMessage } from "./cli-prompt";
import { formatLocalServerReadyMessage, resolveChatApiUrl, shouldAutoStartLocalServerForChat } from "./cli-server";
import { resolveCliVersion } from "./cli-version";
import { createClient } from "./client";
import { buildFileContext } from "./file-context";
import { ensureLocalServer } from "./server-daemon";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import type { Session, SessionStore } from "./session-types";
import { createSession, readStore, writeStore } from "./storage";
import { clearScreen, printDim, printError, printOutput } from "./ui";

const CLI_VERSION = resolveCliVersion();

export const FALLBACK_MODEL = "gpt-5-mini";

function nowIso(): string {
  return new Date().toISOString();
}

export function formatResumeCommand(sessionId: string): string {
  return `acolyte resume ${sessionId}`;
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
