import { z } from "zod";
import type { appConfig as appConfigType } from "./app-config";
import type { newMessage as newMessageType } from "./chat-session";
import type { attachFileToSession as attachFileToSessionType } from "./cli-chat";
import type {
  formatForTool as formatForToolType,
  parseRunExitCode as parseRunExitCodeType,
  showToolResult as showToolResultType,
} from "./cli-format";
import type { handlePrompt as handlePromptType } from "./cli-prompt";
import type {
  formatLocalServerReadyMessage as formatLocalServerReadyMessageType,
  resolveChatApiUrl as resolveChatApiUrlType,
  shouldAutoStartLocalServerForChat as shouldAutoStartLocalServerForChatType,
} from "./cli-server";
import type { createClient as createClientType } from "./client";
import type { readResolvedConfigSync as readResolvedConfigSyncType } from "./config";
import type { runShellCommand as runShellCommandType } from "./core-tools";
import type { ResourceId } from "./resource-id";
import type { ensureLocalServer as ensureLocalServerType } from "./server-daemon";
import type { createSession as createSessionType } from "./storage";
import { t } from "./i18n";

const RUN_MODE_SYSTEM_PROMPT =
  "Run mode: act decisively — make reasonable defaults instead of asking clarifying questions. Answer concisely (prefer <=5 lines). No option menus.";

const runArgsSchema = z.object({
  files: z.array(z.string().min(1)),
  prompt: z.string(),
  verify: z.boolean(),
});

type ParsedRunArgs = { files: string[]; prompt: string; verify: boolean; workspace?: string };

type RunModeDeps = {
  appModel: typeof appConfigType.model;
  attachFileToSession: typeof attachFileToSessionType;
  createClient: typeof createClientType;
  createSession: typeof createSessionType;
  cwd: () => string;
  ensureLocalServer: typeof ensureLocalServerType;
  formatForTool: typeof formatForToolType;
  formatLocalServerReadyMessage: typeof formatLocalServerReadyMessageType;
  hasHelpFlag: (args: string[]) => boolean;
  handlePrompt: typeof handlePromptType;
  newMessage: typeof newMessageType;
  parseRunExitCode: typeof parseRunExitCodeType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readResolvedConfigSync: typeof readResolvedConfigSyncType;
  resolveChatApiUrl: typeof resolveChatApiUrlType;
  runResourceId: (sessionId: string) => ResourceId;
  runShellCommand: typeof runShellCommandType;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverApiUrl: typeof appConfigType.server.apiUrl;
  serverEntry: string;
  serverPort: typeof appConfigType.server.port;
  shouldAutoStartLocalServerForChat: typeof shouldAutoStartLocalServerForChatType;
  showToolResult: typeof showToolResultType;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
};

export function runResourceId(sessionId: string): ResourceId {
  return `user_run-${sessionId.replace(/^sess_/, "").slice(0, 24)}` as ResourceId;
}

function parseRunArgs(args: string[]): ParsedRunArgs {
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

export async function runMode(args: string[], deps: RunModeDeps): Promise<void> {
  const {
    appModel,
    attachFileToSession,
    createClient,
    createSession,
    cwd,
    ensureLocalServer,
    formatForTool,
    formatLocalServerReadyMessage,
    hasHelpFlag,
    handlePrompt,
    newMessage,
    parseRunExitCode,
    printDim,
    printError,
    readResolvedConfigSync,
    resolveChatApiUrl,
    runResourceId,
    runShellCommand,
    serverApiKey,
    serverApiUrl,
    serverEntry,
    serverPort,
    shouldAutoStartLocalServerForChat,
    showToolResult,
    subcommandError,
    subcommandHelp,
  } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("run");
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
    subcommandError("run");
    return;
  }

  const resolvedConfig = readResolvedConfigSync();
  const session = createSession(appModel);
  session.messages.push(newMessage("system", RUN_MODE_SYSTEM_PROMPT));
  let apiUrl = resolveChatApiUrl(serverApiUrl, serverPort);
  if (shouldAutoStartLocalServerForChat(serverApiUrl)) {
    const daemon = await ensureLocalServer({
      apiUrl,
      port: serverPort,
      apiKey: serverApiKey,
      serverEntry,
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
      printDim(t("run.file_context.attached", { filePath }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("unknown_error");
      printError(message);
      process.exitCode = 1;
      return;
    }
  }

  const success = await handlePrompt(parsed.prompt, session, client, {
    resourceId: runResourceId(session.id),
    workspace: parsed.workspace,
  });
  if (!success) {
    process.exitCode = 1;
    return;
  }
  if (parsed.verify) {
    const verifyResult = await runShellCommand(cwd(), "bun run verify");
    showToolResult("Run", formatForTool("run", verifyResult), "tool", "bun run verify");
    const verifyExitCode = parseRunExitCode(verifyResult);
    if (verifyExitCode !== null && verifyExitCode !== 0) process.exitCode = 1;
  }
}
