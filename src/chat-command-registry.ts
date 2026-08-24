import { appConfig } from "./app-config";
import {
  CLEAR_SPEC,
  EXIT_SPEC,
  MEMORY_SPEC,
  MODEL_SPEC,
  NEW_SPEC,
  RESUME_SPEC,
  SESSIONS_SPEC,
  SKILLS_SPEC,
  STATUS_SPEC,
  USAGE_SPEC,
  WORKSPACES_SPEC,
} from "./chat-command-specs";
import type { CommandContext, CommandEntry, CommandResult, ParsedCommand } from "./chat-commands-contract";
import { runMemoryAdd, runMemoryList, runMemoryRemove } from "./chat-commands-memory";
import { runModel } from "./chat-commands-model";
import { runResume } from "./chat-commands-resume";
import { runClear, runExit, runNew } from "./chat-commands-session";
import { runSessions } from "./chat-commands-sessions";
import { createSkillHandler, runSkillsPanel } from "./chat-commands-skill";
import { runStatus } from "./chat-commands-status";
import { runUsage } from "./chat-commands-usage";
import { runWorkspacesList, runWorkspacesNew, runWorkspacesSwitch } from "./chat-commands-workspaces";
import type { SkillMeta } from "./skill-contract";
import { getLoadedSkills } from "./skill-ops";

const BUILTIN_COMMANDS: CommandEntry[] = [
  { spec: NEW_SPEC, run: runNew },
  { spec: CLEAR_SPEC, run: runClear },
  { spec: MODEL_SPEC, run: runModel },
  { spec: STATUS_SPEC, run: runStatus },
  { spec: SESSIONS_SPEC, run: runSessions },
  {
    spec: WORKSPACES_SPEC,
    run: runWorkspacesList,
    runSub: { list: runWorkspacesList, new: runWorkspacesNew, switch: runWorkspacesSwitch },
  },
  { spec: SKILLS_SPEC, run: runSkillsPanel },
  { spec: RESUME_SPEC, run: runResume },
  {
    spec: MEMORY_SPEC,
    run: runMemoryList,
    runSub: { add: runMemoryAdd, rm: runMemoryRemove, list: runMemoryList },
  },
  { spec: USAGE_SPEC, run: runUsage },
  { spec: EXIT_SPEC, run: runExit },
];

function skillEntry(skill: SkillMeta): CommandEntry {
  return {
    spec: {
      name: skill.name,
      source: skill.source,
      helpKey: "chat.slash.help.skill",
      usage: `/${skill.name} [prompt]`,
      subcommands: [],
    },
    run: createSkillHandler(skill),
    isSkill: true,
  };
}

/** A project or user skill takes a builtin's name: the user wrote it deliberately, so their authority wins. */
export function resolveCommandRegistry(): CommandEntry[] {
  const skills = getLoadedSkills().map(skillEntry);
  const shadowing = new Set(skills.filter((entry) => entry.spec.source !== "bundled").map((entry) => entry.spec.name));
  const builtins = BUILTIN_COMMANDS.filter(
    (entry) =>
      (entry.spec.flag === undefined || appConfig.features[entry.spec.flag]) && !shadowing.has(entry.spec.name),
  );
  return [...builtins, ...skills];
}

export function findCommandEntry(name: string): CommandEntry | null {
  return resolveCommandRegistry().find((entry) => entry.spec.name === name) ?? null;
}

/** Null when the entry does not accept this input, so the caller reports an unknown command. */
export function runCommandEntry(
  entry: CommandEntry,
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandResult> | null {
  const declared = entry.spec.subcommands.some((sub) => sub.name === parsed.sub);
  const handler = declared ? entry.runSub?.[parsed.sub] : undefined;
  if (handler) return handler(ctx, parsed);
  const args = parsed.sub === "" ? parsed.args : [parsed.sub, ...parsed.args];
  const takesArgs = entry.spec.usage !== undefined || entry.spec.subcommands.length > 0;
  if (args.length > 0 && !takesArgs) return null;
  return entry.run(ctx, { ...parsed, sub: "", args });
}
