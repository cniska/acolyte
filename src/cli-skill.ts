import type { appConfig as appConfigType } from "./app-config";
import type { createMessage as createMessageType } from "./chat-session";
import { parseRepeatableFlag, parseRequiredFlag } from "./cli-args";
import type { attachFileToSession as attachFileToSessionType } from "./cli-chat";
import { formatRunSummary } from "./cli-format";
import type { handlePrompt as handlePromptType } from "./cli-prompt";
import type { createClient as createClientType } from "./client-factory";
import type { CompactBudget } from "./compact-text";
import type { readResolvedConfigSync as readResolvedConfigSyncType } from "./config";
import { t } from "./i18n";
import { userResourceIdFor } from "./resource-id";
import type { apiUrlForPort as apiUrlForPortType, ensureLocalServer as ensureLocalServerType } from "./server-daemon";
import type { createSession as createSessionType } from "./session-store";
import type { findSkillByName as findSkillByNameType, loadSkills as loadSkillsType } from "./skills";

type ParsedSkillArgs = { skillName: string; files: string[]; prompt: string; workspace?: string; model?: string };

type SkillModeDeps = {
  apiUrlForPort: typeof apiUrlForPortType;
  appModel: typeof appConfigType.model;
  attachFileToSession: typeof attachFileToSessionType;
  compactText: (text: string, budget: CompactBudget) => string;
  createClient: typeof createClientType;
  createMessage: typeof createMessageType;
  createSession: typeof createSessionType;
  ensureLocalServer: typeof ensureLocalServerType;
  findSkillByName: typeof findSkillByNameType;
  handlePrompt: typeof handlePromptType;
  hasHelpFlag: (args: string[]) => boolean;
  loadSkills: typeof loadSkillsType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readResolvedConfigSync: typeof readResolvedConfigSyncType;
  readSkillInstructions: (path: string, args?: string) => Promise<string>;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverEntry: string;
  serverPort: typeof appConfigType.server.port;
  skillBudget: CompactBudget;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export function skillResourceId(sessionId: string) {
  return userResourceIdFor("skill", sessionId);
}

export function parseSkillArgs(args: string[]): ParsedSkillArgs {
  const files = parseRepeatableFlag(args, "--file", "--file requires a path");
  const workspace = parseRequiredFlag(args, "--workspace", "--workspace requires a path");
  const model = parseRequiredFlag(args, "--model", "--model requires a model id");
  const tokens: string[] = [];
  let skillName: string | undefined;

  const flagsWithValues = new Set(["--file", "--workspace", "--model"]);
  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.has(args[i])) {
      i++;
      continue;
    }
    if (!skillName) {
      skillName = args[i];
      continue;
    }
    tokens.push(args[i]);
  }

  if (!skillName) throw new Error("skill name is required");
  return { skillName, files, prompt: tokens.join(" ").trim(), workspace, model };
}

export async function skillMode(args: string[], deps: SkillModeDeps): Promise<void> {
  const {
    apiUrlForPort,
    appModel,
    attachFileToSession,
    compactText,
    createClient,
    createMessage,
    createSession,
    ensureLocalServer,
    findSkillByName,
    handlePrompt,
    hasHelpFlag,
    loadSkills,
    printDim,
    printError,
    readResolvedConfigSync,
    readSkillInstructions,
    serverApiKey,
    serverEntry,
    serverPort,
    skillBudget,
    commandError,
    commandHelp,
  } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("skill");
    return;
  }

  let parsed: ParsedSkillArgs;
  try {
    parsed = parseSkillArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid arguments";
    printError(message);
    process.exitCode = 1;
    return;
  }

  await loadSkills();
  const skill = findSkillByName(parsed.skillName);
  if (!skill) {
    printError(t("chat.skill.not_found", { skill: parsed.skillName }));
    process.exitCode = 1;
    return;
  }

  if (!parsed.prompt) {
    commandError("skill");
    return;
  }

  const instructions = await readSkillInstructions(skill.path, parsed.prompt);
  const compacted = compactText(instructions, skillBudget);

  const resolvedConfig = readResolvedConfigSync();
  const session = createSession(parsed.model ?? appModel);
  session.messages.push(createMessage("system", `Active skill (${skill.name}):\n${compacted}`));

  const daemon = await ensureLocalServer({ port: serverPort, apiKey: serverApiKey, serverEntry });
  const apiUrl = apiUrlForPort(serverPort);
  if (daemon.started) printDim(t("cli.server.started", { port: daemon.port, pid: daemon.pid }));
  else printDim(t("cli.server.already_running", { port: daemon.port, pid: daemon.pid }));

  const client = createClient({ apiUrl, replyTimeoutMs: resolvedConfig.replyTimeoutMs });

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
    resourceId: skillResourceId(session.id),
    workspace: parsed.workspace,
  });
  const durationMs = Date.now() - startMs;

  const summary = formatRunSummary("skill", session.tokenUsage, durationMs);
  if (summary) printDim(summary);

  if (!success) {
    process.exitCode = 1;
  }
}
