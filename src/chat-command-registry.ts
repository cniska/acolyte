import { appConfig } from "./app-config";
import type { CommandContext, CommandEntry, CommandResult, ParsedCommand } from "./chat-commands-contract";
import { runMemoryAdd, runMemoryList, runMemoryRemove } from "./chat-commands-memory";
import { runModel } from "./chat-commands-model";
import { runResume } from "./chat-commands-resume";
import { runClear, runExit, runNew } from "./chat-commands-session";
import { runSessions } from "./chat-commands-sessions";
import { runSkillsPanel } from "./chat-commands-skill";
import { runStatus } from "./chat-commands-status";
import { runUsage } from "./chat-commands-usage";
import { runWorkspacesList, runWorkspacesNew, runWorkspacesSwitch } from "./chat-commands-workspaces";

const BUILTIN_COMMANDS: CommandEntry[] = [
  {
    spec: { name: "new", source: "builtin", helpKey: "chat.slash.help.new", subcommands: [] },
    run: runNew,
  },
  {
    spec: { name: "clear", source: "builtin", helpKey: "chat.slash.help.clear", subcommands: [] },
    run: runClear,
  },
  {
    spec: { name: "model", source: "builtin", helpKey: "chat.slash.help.model", subcommands: [] },
    run: runModel,
  },
  {
    spec: { name: "status", source: "builtin", helpKey: "chat.slash.help.status", subcommands: [] },
    run: runStatus,
  },
  {
    spec: { name: "sessions", source: "builtin", helpKey: "chat.slash.help.sessions", subcommands: [] },
    run: runSessions,
  },
  {
    spec: {
      name: "workspaces",
      source: "builtin",
      helpKey: "chat.slash.help.workspaces",
      flag: "workspaces",
      subcommands: [
        { name: "list", usage: "/workspaces list", helpKey: "chat.slash.help.workspaces.list" },
        { name: "new", usage: "/workspaces new <name> [-- <prompt>]", helpKey: "chat.slash.help.workspaces.new" },
        { name: "switch", usage: "/workspaces switch <name>", helpKey: "chat.slash.help.workspaces.switch" },
      ],
    },
    run: runWorkspacesList,
    runSub: { list: runWorkspacesList, new: runWorkspacesNew, switch: runWorkspacesSwitch },
  },
  {
    spec: { name: "skills", source: "builtin", helpKey: "chat.slash.help.skills", subcommands: [] },
    run: runSkillsPanel,
  },
  {
    spec: { name: "resume", source: "builtin", helpKey: "chat.slash.help.resume", subcommands: [] },
    run: runResume,
  },
  {
    spec: {
      name: "memory",
      source: "builtin",
      helpKey: "chat.slash.help.memory",
      subcommands: [
        { name: "add", usage: "/memory add [--user|--project] <memory text>", helpKey: "chat.slash.help.memory.add" },
        { name: "rm", usage: "/memory rm <id-prefix>", helpKey: "chat.slash.help.memory.rm" },
        { name: "list", usage: "/memory list [all|user|project] [--archived]", helpKey: "chat.slash.help.memory.list" },
      ],
    },
    run: runMemoryList,
    runSub: { add: runMemoryAdd, rm: runMemoryRemove, list: runMemoryList },
  },
  {
    spec: { name: "usage", source: "builtin", helpKey: "chat.slash.help.usage", subcommands: [] },
    run: runUsage,
  },
  {
    spec: { name: "exit", source: "builtin", helpKey: "chat.slash.help.exit", subcommands: [] },
    run: runExit,
  },
];

/** Commands available right now: a flagged command is absent while its flag is off, never inert. */
export function resolveCommandRegistry(): CommandEntry[] {
  return BUILTIN_COMMANDS.filter((entry) => entry.spec.flag === undefined || appConfig.features[entry.spec.flag]);
}

export function findCommandEntry(name: string): CommandEntry | null {
  return resolveCommandRegistry().find((entry) => entry.spec.name === name) ?? null;
}

export function runCommandEntry(
  entry: CommandEntry,
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const declared = entry.spec.subcommands.some((sub) => sub.name === parsed.sub);
  const handler = declared ? entry.runSub?.[parsed.sub] : undefined;
  if (handler) return handler(ctx, parsed);
  const args = parsed.sub === "" ? parsed.args : [parsed.sub, ...parsed.args];
  return entry.run(ctx, { ...parsed, sub: "", args });
}
