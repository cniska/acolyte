#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { stdout as output } from "node:process";
import { z } from "zod";
import { formatToolHeader } from "./agent";
import {
  editFile,
  fetchWeb,
  findFiles,
  gitDiff,
  gitStatusShort,
  readSnippet,
  runShellCommand,
  searchFiles,
  searchWeb,
} from "./agent-tools";
import { appConfig } from "./app-config";
import { wrapAssistantContent } from "./chat-content";
import { formatColumns, formatRelativeTime } from "./chat-formatters";
import { createProgressTracker } from "./chat-progress";
import { runInkChat } from "./chat-ui";
import { createClient } from "./client";
import {
  type AcolyteConfig,
  readConfig,
  readConfigForScope,
  readResolvedConfigSync,
  setConfigValue,
  unsetConfigValue,
} from "./config";
import { buildFileContext } from "./file-context";
import { addMemory, listMemories } from "./memory";
import { acquireSessionLock, releaseSessionLock } from "./session-lock";
import { createId } from "./short-id";
import { formatStatusOutput as formatStatusOutputShared } from "./status-format";
import { createSession, readStore, writeStore } from "./storage";
import { parseToolProgressLine } from "./tool-progress";
import type { Message, Session, SessionStore } from "./types";
import {
  clearScreen,
  formatCliTitle,
  printDim,
  printError,
  printOutput,
  printToolHeader,
  printWarning,
  streamText,
} from "./ui";

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
const runExitCodeSchema = z.coerce.number().int();
const editArgsSchema = z.object({
  path: z.string().min(1),
  edits: z.array(z.object({ find: z.string().min(1), replace: z.string() })).min(1),
  dryRun: z.boolean(),
});
const editResultSchema = z.object({
  path: z.string().min(1),
  edits: z.coerce.number().int().nonnegative(),
  dryRun: z.boolean(),
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
    { command: "run [--file path] <prompt>", description: "run a single prompt" },
    { command: "history", description: "show recent sessions" },
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

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function parseEditResult(raw: string): { path: string; edits: number; dryRun: boolean } | null {
  const path = raw.match(/^path=(.*)$/m)?.[1]?.trim();
  const editsText = raw.match(/^edits=(.*)$/m)?.[1]?.trim();
  const dryRunText = raw.match(/^dry_run=(.*)$/m)?.[1]?.trim();
  if (!path || !editsText || !dryRunText) {
    return null;
  }
  if (dryRunText !== "true" && dryRunText !== "false") {
    return null;
  }
  const parsed = editResultSchema.safeParse({
    path,
    edits: editsText,
    dryRun: dryRunText === "true",
  });
  return parsed.success ? parsed.data : null;
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

export function formatStatusOutput(status: Record<string, string>): string {
  return formatStatusOutputShared(status);
}

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[39m",
  resetDim: "\x1b[22m",
} as const;

function colorizeDiffLine(line: string): string {
  if (line.startsWith("@@ ")) {
    return `${ANSI.dim}${line}${ANSI.resetDim}`;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return `${ANSI.green}${line}${ANSI.reset}`;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return `${ANSI.red}${line}${ANSI.reset}`;
  }
  if (line.startsWith("… +")) {
    return `${ANSI.dim}${line}${ANSI.resetDim}`;
  }
  return line;
}

function showToolResult(
  title: string,
  content: string,
  style: "plain" | "tool" | "diff" = "plain",
  detail?: string,
): void {
  printToolHeader(title, detail);
  const lines = content.split("\n");
  if (lines.length === 0) {
    printDim("  └ (no output)");
    return;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const prefix = i === 0 ? "  └ " : "    ";
    if (style === "tool") {
      printOutput(`${prefix}${lines[i]}`);
    } else if (style === "diff") {
      printOutput(`${prefix}${colorizeDiffLine(lines[i] ?? "")}`);
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
  if (lines.length === 0 || (lines.length === 1 && lines[0].toLowerCase().startsWith("no matches"))) {
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
  return clampLines(out, 6).join("\n");
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
    out.push(...clampLines(payload, 6));
  };

  const nextAfterStdout = stderrIdx >= 0 ? stderrIdx : lines.length;
  section("stdout:", stdoutIdx, nextAfterStdout);
  section("stderr:", stderrIdx, lines.length);

  return out.join("\n");
}

export function parseRunExitCode(raw: string): number | null {
  const first = raw.split("\n")[0]?.trim() ?? "";
  const match = first.match(/^exit_code=([^\\s]+)$/);
  if (!match) {
    return null;
  }
  const parsed = runExitCodeSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

export function formatForTool(kind: "find" | "search" | "read" | "diff" | "run" | "status", raw: string): string {
  if (kind === "find" || kind === "search") {
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
  const lines = raw.split("\n");
  for (const line of lines) {
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
      preview.push(line);
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

  // Build a compact hunk-centered preview with one context line around edits.
  let currentHunkHeader = "";
  let currentHunkBody: string[] = [];
  const excerpt: string[] = [];
  const flushHunk = (): void => {
    if (!currentHunkHeader) {
      return;
    }
    const changedIdxs = currentHunkBody
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.startsWith("+") || entry.line.startsWith("-"))
      .map((entry) => entry.index);
    if (changedIdxs.length === 0) {
      currentHunkHeader = "";
      currentHunkBody = [];
      return;
    }
    const include = new Set<number>();
    for (const idx of changedIdxs) {
      include.add(idx - 1);
      include.add(idx);
      include.add(idx + 1);
    }
    excerpt.push(currentHunkHeader);
    for (let i = 0; i < currentHunkBody.length; i += 1) {
      if (!include.has(i)) {
        continue;
      }
      const line = currentHunkBody[i];
      if (line === undefined) {
        continue;
      }
      excerpt.push(line);
    }
    currentHunkHeader = "";
    currentHunkBody = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunkHeader = line;
      currentHunkBody = [];
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!currentHunkHeader) {
      continue;
    }
    currentHunkBody.push(line);
  }
  flushHunk();

  return { added, removed, locations, preview: clampLines(excerpt, 18) };
}

export function formatEditUpdateOutput(matches: number, diff: string): string {
  const summary = summarizeDiff(diff);
  const lines = [
    `${countLabel(matches, "replacement", "replacements")} applied.`,
    `${countLabel(summary.locations, "location", "locations")} updated.`,
    `Added ${countLabel(summary.added, "line", "lines")}, removed ${countLabel(summary.removed, "line", "lines")}.`,
  ];
  if (summary.preview.length > 0) {
    lines.push("Preview:");
    lines.push(...summary.preview);
  } else {
    lines.push("No diff preview available (file may be untracked or unchanged in git).");
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

export function displayPromptForOutput(prompt: string): string {
  if (!prompt.startsWith("Dogfood mode:")) {
    return prompt;
  }
  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? prompt;
}

export function formatAssistantReplyOutput(content: string, wrapWidth = 100): string {
  const wrapped = wrapAssistantContent(content, wrapWidth);
  const lines = wrapped.split("\n");
  if (lines.length === 0) {
    return "•";
  }
  return lines
    .map((line, index) => {
      if (index === 0) {
        return line.length > 0 ? `• ${line}` : "•";
      }
      return line.length > 0 ? `  ${line}` : "";
    })
    .join("\n");
}

export function formatProgressEventOutput(
  content: string,
  options?: { lineNumberWidth?: number; bullet?: boolean },
): string {
  const dim = (value: string): string => `\x1b[2m${value}\x1b[22m`;
  const bold = (value: string): string => `\x1b[1m${value}\x1b[22m`;
  const path = (value: string): string => `\x1b[4m\x1b[38;2;168;177;188m${value}\x1b[39m\x1b[24m`;
  const green = (value: string): string => `\x1b[32m${value}\x1b[39m`;
  const red = (value: string): string => `\x1b[31m${value}\x1b[39m`;
  const greenBg = (value: string): string => `\x1b[32m\x1b[48;2;13;40;24m${value}\x1b[49m\x1b[39m`;
  const redBg = (value: string): string => `\x1b[31m\x1b[48;2;45;11;11m${value}\x1b[49m\x1b[39m`;
  const lines = content.split("\n");
  const parsedLines = lines.map((line) => parseToolProgressLine(line));
  const inferredLineNumberWidth = parsedLines.reduce((max, parsed) => {
    if (parsed.kind === "numberedDiff" || parsed.kind === "numberedContext") {
      return Math.max(max, parsed.lineNumber.length);
    }
    return max;
  }, 0);
  const lineNumberWidth = Math.max(3, options?.lineNumberWidth ?? 0, inferredLineNumberWidth);

  const colorize = (parsed: ReturnType<typeof parseToolProgressLine>): string => {
    switch (parsed.kind) {
      case "header":
        if (["Edit", "Create", "Read", "Delete", "Diff", "Status"].includes(parsed.verb)) {
          return `${bold(`${parsed.verb} `)}${path(parsed.path)}`;
        }
        return `${bold(`${parsed.verb} `)}${dim(parsed.path)}`;
      case "numberedDiff": {
        const colorBg = parsed.marker === "+" ? greenBg : redBg;
        const paddedLineNumber =
          lineNumberWidth > 0 ? parsed.lineNumber.padStart(lineNumberWidth, " ") : parsed.lineNumber;
        const raw = `${paddedLineNumber} ${parsed.marker}${parsed.text.length > 0 ? parsed.text : " "}`;
        const cols = process.stdout.columns ?? 120;
        return colorBg(raw.length < cols - 4 ? raw.padEnd(cols - 4) : raw);
      }
      case "numberedContext": {
        const paddedLineNumber =
          lineNumberWidth > 0 ? parsed.lineNumber.padStart(lineNumberWidth, " ") : parsed.lineNumber;
        const spacing = parsed.spacing.length > 0 ? parsed.spacing : "   ";
        return `${dim(paddedLineNumber)}${spacing}${parsed.text}`;
      }
      case "commandOutput":
        if (parsed.stream === "err" && !parsed.text.startsWith("$ ")) {
          return dim(red(parsed.text));
        }
        return dim(parsed.text);
      case "fileDiff":
        return parsed.marker === "+" ? green(parsed.text) : red(parsed.text);
      case "meta":
        if (options?.lineNumberWidth != null) {
          const rest = parsed.text.length > 1 ? parsed.text.slice(1) : "";
          return `${dim("…".padStart(lineNumberWidth, " "))}${dim(rest)}`;
        }
        return dim(parsed.text);
      default:
        return parsed.text;
    }
  };
  if (lines.length === 0) {
    return options?.bullet === false ? "" : "•";
  }
  const includeBullet = options?.bullet ?? true;
  return lines
    .map((line, index) => {
      const parsed = parsedLines[index] ?? parseToolProgressLine(line);
      if (index === 0) {
        if (!includeBullet) {
          return line.length > 0 ? `    ${colorize(parsed)}` : "";
        }
        return line.length > 0 ? `• ${colorize(parsed)}` : "•";
      }
      return line.length > 0 ? `    ${colorize(parsed)}` : "";
    })
    .join("\n");
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
  options?: { resourceId?: string },
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

function parseRunArgs(args: string[]): { files: string[]; prompt: string; verify: boolean } {
  const files: string[] = [];
  const promptTokens: string[] = [];
  let verify = false;

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
    if (args[i] === "--verify") {
      verify = true;
      continue;
    }

    promptTokens.push(args[i]);
  }

  return runArgsSchema.parse({ files, prompt: promptTokens.join(" ").trim(), verify });
}

export function parseDogfoodArgs(args: string[]): { files: string[]; prompt: string; verify: boolean } {
  const files: string[] = [];
  const promptTokens: string[] = [];
  let verify = true;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("Usage: acolyte dogfood [--file path] [--no-verify] <prompt>");
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

function parseEditArgs(args: string[]): {
  path: string;
  edits: Array<{ find: string; replace: string }>;
  dryRun: boolean;
} {
  const dryRun = args.includes("--dry-run");
  const clean = args.filter((a) => a !== "--dry-run");
  if (clean.length < 3) {
    throw new Error("Usage: /edit <path> <find> <replace> [--dry-run]");
  }
  const [path, find, ...replaceParts] = clean;
  return editArgsSchema.parse({
    path,
    edits: [{ find, replace: replaceParts.join(" ") }],
    dryRun,
  });
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
  let parsed: { files: string[]; prompt: string; verify: boolean };
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
    printError("Usage: acolyte run [--file path] [--verify] <prompt>");
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

  const success = await handlePrompt(prompt, session, client, { resourceId: runResourceId(session.id) });
  if (!success) {
    process.exitCode = 1;
    return;
  }
  if (parsed.verify) {
    const verifyResult = await runShellCommand("bun run verify");
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
    printError("Usage: acolyte dogfood [--file path] [--no-verify] <prompt>");
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

  printError("Usage: acolyte memory [list [all|user|project]|add [--user|--project] <text>]");
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

  printError("Usage: acolyte config <list|set|unset> [--user|--project] [key] [value]");
  printDim(`Keys: ${validKeys.join(", ")}`);
  process.exitCode = 1;
}

async function toolMode(args: string[]): Promise<void> {
  try {
    const [subcommand, ...rest] = args;
    if (subcommand === "find") {
      const pattern = rest.join(" ").trim();
      if (!pattern) {
        printError("Usage: acolyte tool find <pattern>");
        process.exitCode = 1;
        return;
      }
      const result = await findFiles(pattern);
      showToolResult("Find", formatForTool("find", result), "tool", pattern);
      return;
    }

    if (subcommand === "search") {
      const pattern = rest.join(" ").trim();
      if (!pattern) {
        printError("Usage: acolyte tool search <pattern>");
        process.exitCode = 1;
        return;
      }
      const result = await searchFiles(pattern);
      showToolResult("Search", formatForTool("search", result), "tool", pattern);
      return;
    }

    if (subcommand === "web") {
      const query = rest.join(" ").trim();
      if (!query) {
        printError("Usage: acolyte tool web <query>");
        process.exitCode = 1;
        return;
      }
      const result = await searchWeb(query, 5);
      showToolResult("Web", result, "plain", query);
      return;
    }

    if (subcommand === "fetch") {
      const url = rest.join(" ").trim();
      if (!url) {
        printError("Usage: acolyte tool fetch <url>");
        process.exitCode = 1;
        return;
      }
      const result = await fetchWeb(url, 5000);
      showToolResult("Fetch", result, "plain", url);
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
      const result = await editFile(parsed);
      const summary = parseEditResult(result);
      let rendered = false;
      if (summary) {
        const shownPath = displayPath(summary.path);
        if (summary.dryRun) {
          showToolResult(
            "Dry Run",
            `${countLabel(summary.edits, "match", "matches")} would be changed.`,
            "plain",
            shownPath,
          );
          rendered = true;
        } else {
          try {
            const diff = await gitDiff(parsed.path, 1);
            showToolResult("Edit", formatEditUpdateOutput(summary.edits, diff), "diff", shownPath);
            rendered = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to render diff preview";
            if (message.includes("outside repository")) {
              showToolResult(
                "Edit",
                `${countLabel(summary.edits, "replacement", "replacements")} applied.`,
                "plain",
                shownPath,
              );
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

    printError("Usage: acolyte tool <search|web|fetch|read|git-status|git-diff|run|edit> ...");
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool command failed";
    printError(message);
    process.exitCode = 1;
  }
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
