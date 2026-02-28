import { z } from "zod";
import { appConfig } from "./app-config";
import { formatColumns, formatRelativeTime } from "./chat-format";
import {
  attachFileToSession,
  chatModeWithOptions,
  FALLBACK_MODEL,
  formatLocalServerReadyMessage,
  handlePrompt,
  newMessage,
  resolveChatApiUrl,
  resolveLocalDaemonApiUrl,
  shouldAutoStartLocalServerForChat,
} from "./cli";
import { formatForTool, parseRunExitCode, showToolResult, truncateText } from "./cli-format";
import { toolMode } from "./cli-tool-mode";
import { createClient } from "./client";
import { readConfig, readConfigForScope, readResolvedConfigSync, setConfigValue, unsetConfigValue } from "./config";
import { addMemory, listMemories } from "./memory";
import { ensureLocalServer, localServerStatus, stopLocalServer } from "./server-daemon";
import { formatStatusOutput as formatStatusOutputShared } from "./status-format";
import { createSession, readStore } from "./storage";
import { runShellCommand } from "./tools";
import type { SessionStore } from "./types";
import { formatCliTitle, printDim, printError, printOutput } from "./ui";

const SUBCOMMANDS: Record<string, { command: string; usage: string; description: string }> = {
  resume: {
    command: "resume [id-prefix]",
    usage: "acolyte resume [id-prefix]",
    description: "resume previous session",
  },
  run: {
    command: "run <prompt>",
    usage: "acolyte run [--file <path>] [--workspace <path>] [--verify] <prompt>",
    description: "run a single prompt",
  },
  history: { command: "history", usage: "acolyte history", description: "show recent sessions" },
  server: { command: "server", usage: "acolyte server [start|status|stop]", description: "manage local API server" },
  status: { command: "status", usage: "acolyte status", description: "show server status" },
  memory: { command: "memory", usage: "acolyte memory <list|add> [options]", description: "manage memory notes" },
  config: {
    command: "config",
    usage: "acolyte config <list|set|unset> [options]",
    description: "manage local CLI config",
  },
  tool: {
    command: "tool",
    usage: "acolyte tool <find|search|web|fetch|read|git-status|git-diff|run|edit> ...",
    description: "run a tool directly",
  },
};

export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

export function subcommandHelp(name: string): void {
  const entry = SUBCOMMANDS[name];
  if (entry) printDim(`Usage: ${entry.usage}`);
}

export function subcommandError(name: string, message?: string): void {
  const entry = SUBCOMMANDS[name];
  printError(message ?? `Usage: ${entry?.usage ?? `acolyte ${name}`}`);
  process.exitCode = 1;
}

export function isTopLevelHelpCommand(command: string | undefined): boolean {
  return command === "help" || command === "--help" || command === "-h";
}

export function isTopLevelVersionCommand(command: string | undefined): boolean {
  return command === "version" || command === "--version" || command === "-V";
}

export function buildUsageCommandRows(): Array<{ command: string; description: string }> {
  return Object.values(SUBCOMMANDS)
    .filter((entry) => entry.command !== "tool")
    .map((entry) => ({ command: entry.command, description: entry.description }));
}

export function buildUsageOptionRows(): Array<{ option: string; description: string }> {
  return [
    { option: "-h, --help", description: "print help" },
    { option: "-V, --version", description: "print version" },
  ];
}

export function usage(version: string): void {
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
  printOutput(formatCliTitle(version));
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

const RUN_MODE_SYSTEM_PROMPT =
  "Run mode: act decisively — make reasonable defaults instead of asking clarifying questions. Answer concisely (prefer <=5 lines). No option menus.";

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

export function runResourceId(sessionId: string): string {
  return `run-${sessionId.replace(/^sess_/, "").slice(0, 24)}`;
}

export function formatStatusOutput(status: Record<string, string>): string {
  return formatStatusOutputShared(status);
}

export function isServerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Cannot reach server at ");
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

function parseRunArgs(args: string[]): { files: string[]; prompt: string; verify: boolean; workspace?: string } {
  const files: string[] = [];
  const promptTokens: string[] = [];
  let verify = false;
  let workspace: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file") {
      const next = args[i + 1];
      if (!next) throw new Error("--file requires a path");
      files.push(next);
      i += 1;
      continue;
    }
    if (args[i] === "--workspace") {
      const next = args[i + 1];
      if (!next) throw new Error("--workspace requires a path");
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
      if (!next) throw new Error("--file requires a path");
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

async function resumeMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("resume");
    return;
  }
  if (args.length > 1) {
    subcommandError("resume");
    return;
  }
  const resumePrefix = args[0]?.trim() || undefined;
  await chatModeWithOptions({ resumeLatest: true, resumePrefix });
}

async function runMode(args: string[], options?: { skipAutoVerify?: boolean }): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("run");
    return;
  }
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
    subcommandError("run");
    return;
  }

  const defaultModel = appConfig.model ?? FALLBACK_MODEL;
  const resolvedConfig = readResolvedConfigSync();
  const session = createSession(defaultModel);
  session.messages.push(newMessage("system", RUN_MODE_SYSTEM_PROMPT));
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
  const client = createClient({
    apiUrl,
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
    skipAutoVerify: options?.skipAutoVerify,
  });
  if (!success) {
    process.exitCode = 1;
    return;
  }
  if (parsed.verify) {
    const verifyResult = await runShellCommand(process.cwd(), "bun run verify");
    showToolResult("Run", formatForTool("run", verifyResult), "tool", "bun run verify");
    const verifyExitCode = parseRunExitCode(verifyResult);
    if (verifyExitCode !== null && verifyExitCode !== 0) process.exitCode = 1;
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
    ...(parsed.verify
      ? ["- If edits are made, verify with bun run verify."]
      : ["- Verification is disabled for this turn. Do not run verify/test commands."]),
    "",
  ].join("\n");

  const runArgs = [
    ...parsed.files.flatMap((filePath) => ["--file", filePath]),
    ...(parsed.verify ? ["--verify"] : []),
    `${preamble}${parsed.prompt}`,
  ];
  await runMode(runArgs, { skipAutoVerify: !parsed.verify });
}

async function historyMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("history");
    return;
  }
  if (args.length > 0) {
    subcommandError("history");
    return;
  }
  const store = await readStore();
  listSessions(store);
}

async function serveMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("server");
    return;
  }
  const action = args[0];
  if (!action) {
    await import("./server");
    return;
  }
  switch (action) {
    case "start": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(appConfig.server.apiUrl, appConfig.server.port);
      const daemon = await ensureLocalServer({
        apiUrl: localApiUrl,
        port: appConfig.server.port,
        apiKey: appConfig.server.apiKey,
        serverEntry: `${import.meta.dir}/server.ts`,
      });
      printDim(formatLocalServerReadyMessage(daemon));
      return;
    }
    case "status": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(appConfig.server.apiUrl, appConfig.server.port);
      const status = await localServerStatus({ apiKey: appConfig.server.apiKey, apiUrl: localApiUrl });
      if (!status.running) {
        printDim("Local server is not running.");
        return;
      }
      if (status.pid) printDim(`Local server running (pid ${status.pid}) at ${status.apiUrl}`);
      else printDim(`Local server running (unmanaged) at ${status.apiUrl}`);
      return;
    }
    case "stop": {
      if (args.length > 1) return subcommandError("server");
      const stopped = await stopLocalServer({ apiKey: appConfig.server.apiKey });
      if (stopped) {
        printDim("Stopped local server.");
        return;
      }
      const localApiUrl = resolveLocalDaemonApiUrl(appConfig.server.apiUrl, appConfig.server.port);
      const status = await localServerStatus({ apiKey: appConfig.server.apiKey, apiUrl: localApiUrl });
      if (status.running && !status.pid) {
        printDim(`Local server is running unmanaged at ${status.apiUrl}. Stop it manually.`);
        return;
      }
      printDim("Local server is not running.");
      return;
    }
    default:
      subcommandError("server");
  }
}

async function statusMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("status");
    return;
  }
  if (args.length > 0) {
    subcommandError("status");
    return;
  }
  const apiUrl = resolveChatApiUrl(appConfig.server.apiUrl, appConfig.server.port);
  const client = createClient({
    apiUrl,
  });
  try {
    const status = await client.status();
    printDim(formatStatusOutput(status));
  } catch (error) {
    if (shouldAutoStartLocalServerForChat(appConfig.server.apiUrl) && isServerConnectionFailure(error)) {
      const localApiUrl = resolveLocalDaemonApiUrl(appConfig.server.apiUrl, appConfig.server.port);
      const localStatus = await localServerStatus({ apiKey: appConfig.server.apiKey, apiUrl: localApiUrl });
      if (!localStatus.running) {
        printDim("Local server is not running. Start it with: acolyte server start");
        return;
      }
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    process.exitCode = 1;
  }
}

async function memoryMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("memory");
    return;
  }
  const [subcommand, ...rest] = args;
  const validScopes = new Set(["all", "user", "project"]);

  if (subcommand === "list" || !subcommand) {
    const scopeRaw = subcommand === "list" ? rest[0] : undefined;
    if (subcommand === "list" && rest.length > 1) {
      subcommandError("memory", "Usage: acolyte memory list [all|user|project]");
      return;
    }
    const scope = scopeRaw && validScopes.has(scopeRaw) ? scopeRaw : "all";
    if (scopeRaw && !validScopes.has(scopeRaw)) {
      subcommandError("memory", "Usage: acolyte memory list [all|user|project]");
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
      subcommandError("memory", "Usage: acolyte memory add [--user|--project] <memory text>");
      return;
    }
    const entry = await addMemory(content, { scope });
    printDim(`Saved ${scope} memory ${entry.id}.`);
    return;
  }

  subcommandError("memory");
}

async function configMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("config");
    return;
  }
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
    "transportMode",
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
    if (token === "--user") return "user";
    if (token === "--project") return "project";
    return null;
  };

  if (subcommand === "list") {
    const scope = parseScopeFlag(listArgs[0]);
    const config = scope ? await readConfigForScope(scope) : await readConfig();
    const maxKey = validKeys.reduce((max, key) => Math.max(max, `${key}:`.length), 0);
    if (scope) printDim(`${"scope:".padEnd(maxKey + 1)} ${scope}`);
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
      subcommandError("config", "Usage: acolyte config set <key> <value>");
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
      subcommandError("config", "Usage: acolyte config unset <key>");
      return;
    }

    await unsetConfigValue(key, { scope: scope ?? "user" });
    printDim(`Removed config ${key} (${scope ?? "user"}).`);
    return;
  }

  subcommandError("config");
  printDim(`Keys: ${validKeys.join(", ")}`);
}

export const commands: Record<string, (args: string[]) => Promise<void>> = {
  resume: resumeMode,
  run: runMode,
  dogfood: dogfoodMode,
  history: historyMode,
  server: serveMode,
  status: statusMode,
  memory: memoryMode,
  config: configMode,
  tool: toolMode,
};
