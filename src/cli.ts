#!/usr/bin/env bun
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { relative } from "node:path";
import { createBackend } from "./backend";
import {
  editFileReplace,
  gitDiff,
  gitStatusShort,
  readSnippet,
  runShellCommand,
  searchRepo,
} from "./coding-tools";
import { readConfig, setConfigValue, unsetConfigValue } from "./config";
import { buildFileContext } from "./file-context";
import { addMemory, listMemories } from "./memory";
import { createSession, readStore, writeStore } from "./storage";
import type { Message, Session, SessionStore } from "./types";
import {
  banner,
  clearScreen,
  printAssistantHeader,
  printError,
  printInfo,
  printOutput,
  printSection,
  printToolHeader,
  printTool,
  printUser,
  printWarning,
  streamText,
} from "./ui";

const FALLBACK_MODEL = "gpt-5-mini";
const CLI_VERSION = process.env.npm_package_version ?? "dev";

function usage(): void {
  printInfo("Usage: acolyte <chat|run|history|status|memory|config|tool>");
  printInfo("  chat            Start interactive session");
  printInfo("  run [--file path] <prompt>    Send one prompt and exit");
  printInfo("  history         Show recent sessions");
  printInfo("  status          Show backend connection status");
  printInfo("  memory          Manage personal memory notes");
  printInfo("  config          Manage local CLI defaults");
  printInfo("  tool            Run coding tools (search/read/git/run/edit)");
}

function nowIso(): string {
  return new Date().toISOString();
}

function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${crypto.randomUUID()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

function getOrCreateActiveSession(store: SessionStore, model: string): Session {
  const active = store.sessions.find((s) => s.id === store.activeSessionId);
  if (active) {
    return active;
  }

  const created = createSession(model);
  store.sessions.unshift(created);
  store.activeSessionId = created.id;
  return created;
}

function printHelp(): void {
  renderShortcutsPanel();
}

function erasePromptLineIfTty(): void {
  if (!output.isTTY) {
    return;
  }
  output.write("\x1b[1A\r\x1b[2K");
}

const CHAT_COMMANDS = [
  "?",
  "/exit",
];

const COMMAND_ALIASES: Record<string, string> = {};

const INTERNAL_CHAT_COMMANDS = new Set([
  "/search",
  "/read",
  "/git-status",
  "/git-diff",
  "/run",
  "/verify",
  "/edit",
  "/file",
  "/remember",
  "/memories",
  "/status",
  "/new",
  "/history",
  "/sessions",
  "/use",
  "/resume",
  "/title",
  "/model",
  "/clear",
]);
const SHORTCUT_PANEL_LINES = [
  "  /exit quit",
] as const;
const SHORTCUT_PANEL_COMPACT_LINES = [
  "  /exit quit",
] as const;

function renderShortcutsPanel(): void {
  const width = output.columns ?? 120;
  const lines = width < 96 ? SHORTCUT_PANEL_COMPACT_LINES : SHORTCUT_PANEL_LINES;
  for (const line of lines) {
    printInfo(line);
  }
}

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
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
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

function normalizeSuggestions(commands: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const command of commands) {
    const canonical = resolveCommandAlias(command);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

function listSessions(store: SessionStore): void {
  if (store.sessions.length === 0) {
    printInfo("No saved sessions.");
    return;
  }

  for (const [idx, session] of store.sessions.slice(0, 20).entries()) {
    const active = session.id === store.activeSessionId ? "*" : " ";
    const prefix = idx === 0 ? "  └ " : "    ";
    const updated = formatTimestamp(session.updatedAt);
    printInfo(`${prefix}${active} ${session.id.slice(0, 12)}  ${session.model}  ${updated}  ${session.title}`);
  }
}

function findSessionByPrefix(store: SessionStore, prefix: string): Session | null {
  const needle = prefix.trim();
  if (!needle) {
    return null;
  }

  const matches = store.sessions.filter((s) => s.id.startsWith(needle));
  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

function printSessionHistory(session: Session): void {
  if (session.messages.length === 0) {
    printInfo("Session is empty.");
    return;
  }

  for (const [idx, msg] of session.messages.entries()) {
    const who = msg.role === "user" ? "you" : msg.role === "assistant" ? "Acolyte" : "system";
    const prefix = idx === 0 ? "  └ " : "    ";
    printInfo(`${prefix}[${formatTimestamp(msg.timestamp)}] ${who}: ${truncateText(msg.content, 180)}`);
  }
}

function printMemoryRows(rows: Awaited<ReturnType<typeof listMemories>>): void {
  if (rows.length === 0) {
    printInfo("No memories saved.");
    return;
  }

  for (const [idx, row] of rows.slice(0, 50).entries()) {
    const prefix = idx === 0 ? "  └ " : "    ";
    printInfo(`${prefix}${row.id.slice(0, 12)}  ${formatTimestamp(row.createdAt)}  ${truncateText(row.content, 160)}`);
  }
}

function formatToolContext(label: string, content: string): string {
  return [`Tool context: ${label}`, "```text", content, "```"].join("\n");
}

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function parseEditResult(raw: string): { path: string; matches: number; dryRun: boolean } | null {
  const path = raw.match(/^path=(.*)$/m)?.[1]?.trim();
  const matchesText = raw.match(/^matches=(.*)$/m)?.[1]?.trim();
  const dryRunText = raw.match(/^dry_run=(.*)$/m)?.[1]?.trim();
  const matches = matchesText ? Number.parseInt(matchesText, 10) : Number.NaN;
  if (!path || Number.isNaN(matches) || !dryRunText) {
    return null;
  }
  return {
    path,
    matches,
    dryRun: dryRunText === "true",
  };
}

function displayPath(pathInput: string): string {
  const rel = relative(process.cwd(), pathInput);
  if (!rel || rel.startsWith("..")) {
    return pathInput;
  }
  return rel;
}

export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function formatStatusOutput(status: string): string {
  const pairs = status
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.includes("="));
  if (pairs.length === 0) {
    return status;
  }
  return pairs.join("\n");
}

function showToolResult(
  title: string,
  content: string,
  style: "plain" | "tool" = "plain",
  detail?: string,
): void {
  printToolHeader(title, detail);
  const lines = content.split("\n");
  if (lines.length === 0) {
    printInfo("  └ (no output)");
    return;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const prefix = i === 0 ? "  └ " : "    ";
    if (style === "tool") {
      printTool(`${prefix}${lines[i]}`);
    } else {
      printOutput(`${prefix}${lines[i]}`);
    }
  }
}

export function clampLines(lines: string[], maxLines: number, overflowTolerance = 4): string[] {
  if (lines.length <= maxLines + overflowTolerance) {
    return lines;
  }
  return [...lines.slice(0, maxLines - 1), `… +${lines.length - (maxLines - 1)} lines`];
}

export function formatSearchOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (
    lines.length === 0 ||
    (lines.length === 1 && lines[0].toLowerCase().startsWith("no matches"))
  ) {
    return "No matches.";
  }
  const files = new Set<string>();
  for (const line of lines) {
    const firstColon = line.indexOf(":");
    if (firstColon > 0) {
      files.add(line.slice(0, firstColon));
    }
  }
  const summary = `${countLabel(lines.length, "match", "matches")} in ${countLabel(files.size, "file", "files")}`;
  return [summary, ...clampLines(lines, 12)].join("\n");
}

export function formatReadOutput(raw: string): string {
  const lines = raw.split("\n");
  const normalized = [...lines];
  if (normalized[0]?.startsWith("File: ")) {
    const rawPath = normalized[0].slice("File: ".length).trim();
    normalized[0] = `File: ${displayPath(rawPath)}`;
  }
  const contentLines = Math.max(0, normalized.length - (normalized[0]?.startsWith("File: ") ? 1 : 0));
  const summary = countLabel(contentLines, "line", "lines");
  return [summary, ...clampLines(normalized, 48)].join("\n");
}

export function formatDiffOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  let filesChanged = 0;
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      filesChanged += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      removed += 1;
    }
  }
  const summary = `${countLabel(filesChanged, "file", "files")} changed, +${added} -${removed}`;
  return [summary, ...clampLines(lines, 64)].join("\n");
}

export function formatGitStatusOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return "working tree clean";
  }

  const branchLine = lines[0].startsWith("## ") ? lines[0] : undefined;
  const changed = lines.filter((line) => !line.startsWith("## ")).length;
  const summary = changed === 0 ? "working tree clean" : `${countLabel(changed, "changed file", "changed files")}`;
  const out: string[] = [summary];
  if (branchLine) {
    out.push(branchLine);
  }
  out.push(...lines.filter((line) => !line.startsWith("## ")));
  return clampLines(out, 20).join("\n");
}

export function formatRunOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length === 0) {
    return "(no output)";
  }

  const exitLine = lines[0];
  const exitCode = Number.parseInt(exitLine.replace("exit_code=", "").trim(), 10);
  const durationLine = lines[1]?.startsWith("duration_ms=") ? lines[1] : null;
  const stdoutIdx = lines.findIndex((line) => line.trim() === "stdout:");
  const stderrIdx = lines.findIndex((line) => line.trim() === "stderr:");
  const out: string[] = [exitLine];
  if (durationLine) {
    out.push(durationLine);
  }

  const section = (name: "stdout:" | "stderr:", start: number, end: number): void => {
    if (start < 0) {
      return;
    }
    let payload = lines.slice(start + 1, end).filter((line) => line.trim().length > 0);
    if (name === "stderr:" && exitCode === 0 && stdoutIdx >= 0) {
      payload = [];
    }
    if (payload.length === 0) {
      return;
    }
    out.push(name);
    if (payload.length <= 12) {
      out.push(...payload);
      return;
    }
    out.push(...payload.slice(0, 6));
    out.push(`… +${payload.length - 9} lines`);
    out.push(...payload.slice(-3));
  };

  const nextAfterStdout = stderrIdx >= 0 ? stderrIdx : lines.length;
  section("stdout:", stdoutIdx, nextAfterStdout);
  section("stderr:", stderrIdx, lines.length);

  return out.join("\n");
}

export function formatForTool(kind: "search" | "read" | "diff" | "run" | "status", raw: string): string {
  if (kind === "search") {
    return formatSearchOutput(raw);
  }
  if (kind === "read") {
    return formatReadOutput(raw);
  }
  if (kind === "diff") {
    return formatDiffOutput(raw);
  }
  if (kind === "run") {
    return formatRunOutput(raw);
  }
  return formatGitStatusOutput(raw);
}

export function summarizeDiff(raw: string): {
  added: number;
  removed: number;
  locations: number;
  preview: string[];
} {
  const preview: string[] = [];
  let added = 0;
  let removed = 0;
  let locations = 0;
  for (const line of raw.split("\n")) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@ ")) {
      locations += 1;
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      preview.push(line);
      continue;
    }
    if (line.startsWith("-")) {
      removed += 1;
      preview.push(line);
    }
  }
  return { added, removed, locations, preview: clampLines(preview, 14) };
}

export function formatEditUpdateOutput(matches: number, diff: string): string {
  const summary = summarizeDiff(diff);
  const lines = [
    `${countLabel(matches, "replacement", "replacements")} applied.`,
    `${countLabel(summary.locations, "location", "locations")} updated.`,
    `Added ${countLabel(summary.added, "line", "lines")}, removed ${countLabel(summary.removed, "line", "lines")}.`,
  ];
  if (summary.preview.length > 0) {
    lines.push(...summary.preview);
  }
  return lines.join("\n");
}

function formatReadDetail(pathInput: string, start?: string, end?: string): string {
  if (!start && !end) {
    return pathInput;
  }
  const from = start ?? "1";
  const to = end ?? "EOF";
  return `${pathInput}:${from}-${to}`;
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

async function buildHistoryWithMemoryContext(history: Message[]): Promise<Message[]> {
  const memories = await listMemories();
  const top = memories.slice(0, 8);
  if (top.length === 0) {
    return history;
  }

  const memoryLines = top.map((m) => `- ${m.content}`);
  const context: Message = {
    id: `msg_${crypto.randomUUID()}`,
    role: "system",
    content: `User memory context:\n${memoryLines.join("\n")}`,
    timestamp: nowIso(),
  };

  return [context, ...history];
}

async function handlePrompt(prompt: string, session: Session, backend = createBackend()): Promise<void> {
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  printUser(prompt);
  printAssistantHeader();

  try {
    const historyWithContext = await buildHistoryWithMemoryContext(session.messages);
    const reply = await backend.reply({
      message: prompt,
      history: historyWithContext,
      model: session.model,
    });

    await streamText(reply.output);
    session.messages.push(newMessage("assistant", reply.output));
    session.model = reply.model;
    session.updatedAt = nowIso();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    session.updatedAt = nowIso();
  }
}

async function attachFileToSession(session: Session, filePath: string): Promise<void> {
  const context = await buildFileContext(filePath);
  session.messages.push(newMessage("system", context));
  session.updatedAt = nowIso();
}

function parseRunArgs(args: string[]): { files: string[]; prompt: string } {
  const files: string[] = [];
  const promptTokens: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("Usage: acolyte run --file <path> <prompt>");
      }
      files.push(next);
      i += 1;
      continue;
    }

    promptTokens.push(args[i]);
  }

  return { files, prompt: promptTokens.join(" ").trim() };
}

function parseEditArgs(args: string[]): {
  path: string;
  find: string;
  replace: string;
  dryRun: boolean;
} {
  const dryRun = args.includes("--dry-run");
  const clean = args.filter((a) => a !== "--dry-run");
  if (clean.length < 3) {
    throw new Error("Usage: /edit <path> <find> <replace> [--dry-run]");
  }
  const [path, find, ...replaceParts] = clean;
  return {
    path,
    find,
    replace: replaceParts.join(" "),
    dryRun,
  };
}

async function chatMode(): Promise<void> {
  const config = await readConfig();
  const store = await readStore();
  const defaultModel = process.env.ACOLYTE_MODEL ?? config.model ?? FALLBACK_MODEL;
  let session = getOrCreateActiveSession(store, defaultModel);

  if (output.isTTY) {
    clearScreen();
  }
  banner(session.model, session.id, CLI_VERSION);

  const rl = createInterface({
    input,
    output,
    // Lower timeout so Esc keypress is handled quickly instead of waiting for possible sequences.
    escapeCodeTimeout: 25,
  });
  const canUseHotkeys = Boolean(input.isTTY && typeof input.setRawMode === "function");
  const wasRawMode = canUseHotkeys ? input.isRaw : false;
  let shortcutsOpen = false;

  const closeShortcutsPanel = (): void => {
    if (!shortcutsOpen || !output.isTTY) {
      shortcutsOpen = false;
      return;
    }
    // Restore prompt anchor and clear everything below it in one pass.
    output.write("\x1b[u\x1b[J\r\x1b[K> ");
    shortcutsOpen = false;
  };

  const openShortcutsPanel = (): void => {
    if (!output.isTTY) {
      printHelp();
      shortcutsOpen = false;
      return;
    }
    output.write("\r\x1b[K> ");
    output.write("\x1b[s\n\n");
    renderShortcutsPanel();
    output.write("\x1b[u");
    shortcutsOpen = true;
  };

  const onKeypress = (str: string, key?: { name?: string }): void => {
    if (key?.name === "escape" || str.includes("\x1b")) {
      if (shortcutsOpen) {
        closeShortcutsPanel();
      }
      return;
    }
    if (str !== "?") {
      return;
    }
    if (rl.line.trim() !== "?") {
      return;
    }
    rl.write("", { ctrl: true, name: "u" });
    if (shortcutsOpen) {
      closeShortcutsPanel();
      return;
    }
    openShortcutsPanel();
  };
  if (canUseHotkeys) {
    emitKeypressEvents(input);
    if (!wasRawMode) {
      input.setRawMode(true);
    }
    input.on("keypress", onKeypress);
  }

  const persist = async (): Promise<void> => {
    await writeStore(store);
  };
  const backend = createBackend({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  process.on("SIGINT", async () => {
    if (canUseHotkeys) {
      input.off("keypress", onKeypress);
      if (!wasRawMode) {
        input.setRawMode(false);
      }
    }
    await persist();
    rl.close();
    process.exit(0);
  });

  while (true) {
    let line = "";
    try {
      if (output.isTTY) {
        output.write("> ");
        output.write("\x1b[s\n");
        printInfo("  ? shortcuts");
        output.write("\x1b[u");
        line = (await rl.question("")).trim();
      } else {
        line = (await rl.question("> ")).trim();
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "ERR_USE_AFTER_CLOSE") {
        if (canUseHotkeys) {
          input.off("keypress", onKeypress);
          if (!wasRawMode) {
            input.setRawMode(false);
          }
        }
        await persist();
        return;
      }

      throw error;
    }
    if (output.isTTY && !shortcutsOpen) {
      output.write("\x1b[u\x1b[J");
    }
    if (!line) {
      continue;
    }

    if (shortcutsOpen) {
      closeShortcutsPanel();
    }

    if (line.startsWith("/") || line === "?") {
      const [rawCommand] = line === "?" ? ["?"] : line.split(/\s+/);
      const command = resolveCommandAlias(rawCommand);
      if (command === "?") {
        if (output.isTTY) {
          if (shortcutsOpen) {
            closeShortcutsPanel();
          } else {
            openShortcutsPanel();
          }
        } else {
          erasePromptLineIfTty();
          printHelp();
        }
      } else if (command === "/exit") {
        if (canUseHotkeys) {
          input.off("keypress", onKeypress);
          if (!wasRawMode) {
            input.setRawMode(false);
          }
        }
        await persist();
        rl.close();
        return;
      } else if (INTERNAL_CHAT_COMMANDS.has(command)) {
        printWarning(
          `\`${rawCommand}\` is internal. Ask naturally in chat, or use \`acolyte tool ...\` for advanced usage.`,
        );
      } else {
        const suggestions = normalizeSuggestions(suggestCommands(rawCommand, 3));
        if (suggestions.length === 1) {
          printWarning(`Unknown command: ${rawCommand}. Did you mean ${suggestions[0]}?`);
        } else if (suggestions.length > 1) {
          printWarning(`Unknown command: ${rawCommand}. Try: ${suggestions.join(", ")}`);
        } else {
          printWarning(`Unknown command: ${rawCommand}`);
        }
      }

      await persist();
      continue;
    }

    await handlePrompt(line, session, backend);
    await persist();
  }
}

async function runMode(args: string[]): Promise<void> {
  let parsed: { files: string[]; prompt: string };
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
    printError("Usage: acolyte run [--file path] <prompt>");
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  const store = await readStore();
  const defaultModel = process.env.ACOLYTE_MODEL ?? config.model ?? FALLBACK_MODEL;
  const session = getOrCreateActiveSession(store, defaultModel);
  const backend = createBackend({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  for (const filePath of parsed.files) {
    try {
      await attachFileToSession(session, filePath);
      printInfo(`Attached file context from ${filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      printError(message);
      process.exitCode = 1;
      return;
    }
  }

  await handlePrompt(prompt, session, backend);
  await writeStore(store);
}

async function historyMode(): Promise<void> {
  const store = await readStore();
  printSection(`• Sessions (${store.sessions.length})`);
  listSessions(store);
}

async function statusMode(): Promise<void> {
  const config = await readConfig();
  const backend = createBackend({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });
  try {
    const status = await backend.status();
    showToolResult("Status", formatStatusOutput(status), "tool");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    process.exitCode = 1;
  }
}

async function memoryMode(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === "list" || !subcommand) {
    const rows = await listMemories();
    printSection(`• Memories (${rows.length})`);
    printMemoryRows(rows);
    return;
  }

  if (subcommand === "add") {
    const content = rest.join(" ").trim();
    if (!content) {
      printError("Usage: acolyte memory add <memory text>");
      process.exitCode = 1;
      return;
    }
    const entry = await addMemory(content);
    printInfo(`Saved memory ${entry.id.slice(0, 12)}.`);
    return;
  }

  printError("Usage: acolyte memory [list|add <text>]");
  process.exitCode = 1;
}

async function configMode(args: string[]): Promise<void> {
  const [subcommand, key, ...rest] = args;
  const valid = new Set(["model", "apiUrl", "apiKey"]);

  if (!subcommand || subcommand === "list") {
    const config = await readConfig();
    printInfo(`model=${config.model ?? ""}`);
    printInfo(`apiUrl=${config.apiUrl ?? ""}`);
    printInfo(`apiKey=${config.apiKey ? "***set***" : ""}`);
    return;
  }

  if (subcommand === "set") {
    if (!key || !valid.has(key)) {
      printError("Usage: acolyte config set <model|apiUrl|apiKey> <value>");
      process.exitCode = 1;
      return;
    }

    const value = rest.join(" ").trim();
    if (!value) {
      printError("Config value cannot be empty");
      process.exitCode = 1;
      return;
    }

    await setConfigValue(key as "model" | "apiUrl" | "apiKey", value);
    printInfo(`Saved config ${key}.`);
    return;
  }

  if (subcommand === "unset") {
    if (!key || !valid.has(key)) {
      printError("Usage: acolyte config unset <model|apiUrl|apiKey>");
      process.exitCode = 1;
      return;
    }

    await unsetConfigValue(key as "model" | "apiUrl" | "apiKey");
    printInfo(`Removed config ${key}.`);
    return;
  }

  printError("Usage: acolyte config [list|set|unset] ...");
  process.exitCode = 1;
}

async function toolMode(args: string[]): Promise<void> {
  try {
    const [subcommand, ...rest] = args;
    if (subcommand === "search") {
      const pattern = rest.join(" ").trim();
      if (!pattern) {
        printError("Usage: acolyte tool search <pattern>");
        process.exitCode = 1;
        return;
      }
      const result = await searchRepo(pattern);
      showToolResult("Search", formatForTool("search", result), "tool", pattern);
      return;
    }

    if (subcommand === "read") {
      const [pathInput, start, end] = rest;
      if (!pathInput) {
        printError("Usage: acolyte tool read <path> [start] [end]");
        process.exitCode = 1;
        return;
      }
      const snippet = await readSnippet(pathInput, start, end);
      showToolResult("Read", formatForTool("read", snippet), "plain", formatReadDetail(pathInput, start, end));
      return;
    }

    if (subcommand === "git-status") {
      const result = await gitStatusShort();
      showToolResult("Git Status", formatForTool("status", result), "tool");
      return;
    }

    if (subcommand === "git-diff") {
      const [pathInput, context] = rest;
      const ctxRaw = context ? Number.parseInt(context, 10) : undefined;
      const ctx = ctxRaw !== undefined && !Number.isNaN(ctxRaw) ? ctxRaw : 3;
      const result = await gitDiff(pathInput, ctx);
      showToolResult("Diff", formatForTool("diff", result), "plain", pathInput ?? ".");
      return;
    }

    if (subcommand === "run") {
      const command = rest.join(" ").trim();
      if (!command) {
        printError("Usage: acolyte tool run <command>");
        process.exitCode = 1;
        return;
      }
      const result = await runShellCommand(command);
      showToolResult("Run", formatForTool("run", result), "plain", command);
      return;
    }

    if (subcommand === "edit") {
      let parsed: ReturnType<typeof parseEditArgs>;
      try {
        parsed = parseEditArgs(rest);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid edit args";
        printError(message.replace("/edit", "acolyte tool edit"));
        process.exitCode = 1;
        return;
      }
      const result = await editFileReplace(parsed);
      const summary = parseEditResult(result);
      let rendered = false;
      if (summary) {
        const shownPath = displayPath(summary.path);
        if (summary.dryRun) {
          showToolResult("Dry Run", `${countLabel(summary.matches, "match", "matches")} would be changed.`, "plain", shownPath);
          rendered = true;
        } else {
          try {
            const diff = await gitDiff(parsed.path, 3);
            showToolResult("Update", formatEditUpdateOutput(summary.matches, diff), "plain", shownPath);
            rendered = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to render diff preview";
            if (message.includes("outside repository")) {
              showToolResult("Edited", `${countLabel(summary.matches, "replacement", "replacements")} applied.`, "plain", shownPath);
              rendered = true;
              printWarning("Diff preview unavailable (file is outside current repository).");
            } else {
              printWarning(message);
            }
          }
        }
      }
      if (!rendered) {
        showToolResult("Edit", result, "plain", parsed.path);
      }
      return;
    }

    printError("Usage: acolyte tool <search|read|git-status|git-diff|run|edit> ...");
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool command failed";
    printError(message);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "chat") {
    await chatMode();
    return;
  }

  if (command === "run") {
    await runMode(args);
    return;
  }

  if (command === "history") {
    await historyMode();
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
