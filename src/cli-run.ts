import { z } from "zod";
import type { appConfig as appConfigType } from "./app-config";
import type { createMessage as createMessageType } from "./chat-session";
import type { attachFileToSession as attachFileToSessionType } from "./cli-chat";
import { formatRunSummary } from "./cli-format";
import type { handlePrompt as handlePromptType } from "./cli-prompt";
import type { createClient as createClientType } from "./client-factory";
import type { readResolvedConfigSync as readResolvedConfigSyncType } from "./config";
import { t } from "./i18n";
import { type ResourceId, userResourceIdFor } from "./resource-id";
import type { apiUrlForPort as apiUrlForPortType, ensureLocalServer as ensureLocalServerType } from "./server-daemon";
import type { createSession as createSessionType } from "./storage";

const RUN_MODE_SYSTEM_PROMPT =
  "Run mode: act decisively — make reasonable defaults instead of asking clarifying questions. Answer concisely (prefer <=5 lines). No option menus.";

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
  const files: string[] = [];
  const promptParts: string[] = [];
  let workspace: string | undefined;
  let model: string | undefined;

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
    if (args[i] === "--model") {
      const next = args[i + 1];
      if (!next) throw new Error("--model requires a model id");
      model = next;
      i += 1;
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
