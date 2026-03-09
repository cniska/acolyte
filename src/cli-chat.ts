import { stdout as output } from "node:process";
import { appConfig } from "./app-config";
import { newMessage } from "./chat-session";
import { runInkChat } from "./chat-ui";
import { resolveCliVersion } from "./cli-version";
import { createClient } from "./client";
import { nowIso } from "./datetime";
import { buildFileContext } from "./file-context";
import { t } from "./i18n";
import { apiUrlForPort, ensureLocalServer } from "./server-daemon";
import type { Session, SessionState } from "./session-contract";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import { createSession, readStore, writeStore } from "./storage";
import { clearScreen, printDim, printError } from "./ui";

const CLI_VERSION = resolveCliVersion();

type ResumeTarget =
  | { kind: "ok"; session: Session }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] };

function resolveResumeTarget(
  store: SessionState,
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

export function formatResumeCommand(sessionId: string): string {
  return `acolyte resume ${sessionId}`;
}

export async function attachFileToSession(session: Session, filePath: string): Promise<void> {
  const context = await buildFileContext(filePath);
  session.messages.push(newMessage("system", context));
  session.updatedAt = nowIso();
}

export async function chatModeWithOptions(options: { resumeLatest: boolean; resumePrefix?: string }): Promise<void> {
  const store = await readStore();
  const defaultModel = appConfig.model;
  const resolved = resolveResumeTarget(store, options);
  if (resolved?.kind === "not_found") {
    printError(t("chat.resume.not_found", { prefix: resolved.prefix }));
    process.exitCode = 1;
    return;
  }
  if (resolved?.kind === "ambiguous") {
    const sample = resolved.matches.slice(0, 6).map((item) => item.id);
    printError(t("chat.resume.ambiguous", { prefix: resolved.prefix, matches: sample.join(", ") }));
    printDim(t("chat.resume.matches", { matches: sample.join(", ") }));
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
    printError(t("chat.session.locked", { pid: lock.ownerPid ?? "unknown" }));
    printDim(t("chat.resume.use_command", { command: formatResumeCommand(session.id) }));
    process.exitCode = 1;
    return;
  }
  const daemon = await ensureLocalServer({
    port: appConfig.server.port,
    apiKey: appConfig.server.apiKey,
    serverEntry: `${import.meta.dir}/server.ts`,
  });
  const apiUrl = apiUrlForPort(appConfig.server.port);
  if (daemon.started) printDim(t("cli.server.started", { port: daemon.port, pid: daemon.pid }));
  else printDim(t("cli.server.already_running", { port: daemon.port, pid: daemon.pid }));
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
    printDim(t("chat.resume.with_command", { command: formatResumeCommand(resumeId) }));
  } finally {
    releaseSessionLock(session.id);
  }
}
