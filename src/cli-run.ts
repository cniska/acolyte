import { z } from "zod";
import type { appConfig as appConfigType } from "./app-config";
import type { createMessage as createMessageType } from "./chat-session";
import { parseRepeatableFlag, parseRequiredFlag } from "./cli-args";
import type { attachFileToSession as attachFileToSessionType } from "./cli-chat";
import { formatRunSummary } from "./cli-format";
import type { handlePrompt as handlePromptType } from "./cli-prompt";
import type { createClient as createClientType } from "./client-factory";
import type { readResolvedConfigSync as readResolvedConfigSyncType } from "./config";
import { t } from "./i18n";
import { type ResourceId, userResourceIdFor } from "./resource-id";
import type { apiUrlForPort as apiUrlForPortType, ensureLocalServer as ensureLocalServerType } from "./server-daemon";
import type { createSession as createSessionType } from "./storage";

const RUN_MODE_INSTRUCTIONS = [
  "Run mode: keep output tight.",
  "Write ONE short direct sentence before acting, then act IMMEDIATELY.",
  "Do NOT send another assistant message until you are blocked or done.",
  "Do NOT narrate obvious read, edit, search, or verify steps.",
  "Do NOT create a checklist for a simple bounded fix.",
  "The `@signal` line is how you communicate task state to the host.",
  "End every final response with EXACTLY ONE `@signal` line.",
  "Use `@signal done` only when the requested work is complete.",
  "Use `@signal no_op` only when no change is needed.",
  "Use `@signal blocked` only when you cannot proceed without user input.",
  "After `@signal blocked`, write ONE short sentence stating what is missing and why it is needed.",
  "After tool output, add text only if it says something the tool output did not already make clear.",
  "If a write-tool diff already makes the result obvious, say NOTHING after it.",
  "If the result is obvious from the tool output, stop.",
  "Prefer short prose, not dash bullets or option menus.",
];

export const RUN_MODE_SYSTEM_PROMPT = RUN_MODE_INSTRUCTIONS.join(" ");

const runArgsSchema = z.object({
  files: z.array(z.string().min(1)),
  prompt: z.string(),
});

type ParsedRunArgs = { files: string[]; prompt: string; workspace?: string; model?: string };

type RunModeDeps = {
  apiUrlForPort: typeof apiUrlForPortType;
  appModel: typeof appConfigType.model;
  attachFileToSession: typeof attachFileToSessionType;
  createClient: typeof createClientType;
  createSession: typeof createSessionType;
  ensureLocalServer: typeof ensureLocalServerType;
  hasHelpFlag: (args: string[]) => boolean;
  handlePrompt: typeof handlePromptType;
  createMessage: typeof createMessageType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readResolvedConfigSync: typeof readResolvedConfigSyncType;
  runResourceId: (sessionId: string) => ResourceId;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverEntry: string;
  serverPort: typeof appConfigType.server.port;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export function runResourceId(sessionId: string): ResourceId {
  return userResourceIdFor("run", sessionId);
}

function parseRunArgs(args: string[]): ParsedRunArgs {
  const files = parseRepeatableFlag(args, "--file", "--file requires a path");
  const workspace = parseRequiredFlag(args, "--workspace", "--workspace requires a path");
  const model = parseRequiredFlag(args, "--model", "--model requires a model id");
  const promptParts: string[] = [];

  const flagsWithValues = new Set(["--file", "--workspace", "--model"]);
  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.has(args[i])) {
      i++;
      continue;
    }
    promptParts.push(args[i]);
  }

  return { ...runArgsSchema.parse({ files, prompt: promptParts.join(" ").trim() }), workspace, model };
}

export async function runMode(args: string[], deps: RunModeDeps): Promise<void> {
  const {
    apiUrlForPort,
    appModel,
    attachFileToSession,
    createClient,
    createSession,
    ensureLocalServer,
    hasHelpFlag,
    handlePrompt,
    createMessage,
    printDim,
    printError,
    readResolvedConfigSync,
    runResourceId,
    serverApiKey,
    serverEntry,
    serverPort,
    commandError,
    commandHelp,
  } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("run");
    return;
  }
  let parsed: ParsedRunArgs;
  try {
    parsed = parseRunArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("run.args.invalid");
    printError(message);
    process.exitCode = 1;
    return;
  }

  if (!parsed.prompt) {
    commandError("run");
    return;
  }

  const resolvedConfig = readResolvedConfigSync();
  const session = createSession(parsed.model ?? appModel);
  session.messages.push(createMessage("system", RUN_MODE_SYSTEM_PROMPT));
  const daemon = await ensureLocalServer({
    port: serverPort,
    apiKey: serverApiKey,
    serverEntry,
  });
  const apiUrl = apiUrlForPort(serverPort);
  if (daemon.started) printDim(t("cli.server.started", { port: daemon.port, pid: daemon.pid }));
  else printDim(t("cli.server.already_running", { port: daemon.port, pid: daemon.pid }));
  const client = createClient({
    apiUrl,
    replyTimeoutMs: resolvedConfig.replyTimeoutMs,
  });

  for (const filePath of parsed.files) {
    try {
      await attachFileToSession(session, filePath);
      printDim(t("run.file_context.attached", { filePath }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("unknown_error");
      printError(message);
      process.exitCode = 1;
      return;
    }
  }

  const startMs = Date.now();
  const success = await handlePrompt(parsed.prompt, session, client, {
    resourceId: runResourceId(session.id),
    workspace: parsed.workspace,
  });
  const durationMs = Date.now() - startMs;

  const summary = formatRunSummary("run", session.tokenUsage, durationMs);
  if (summary) printDim(summary);

  if (!success) {
    process.exitCode = 1;
  }
}
