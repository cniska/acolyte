import type { CommandSpec } from "./chat-commands-contract";

export const NEW_SPEC: CommandSpec = {
  name: "new",
  source: "builtin",
  help: { key: "chat.slash.help.new" },
  subcommands: [],
};

export const CLEAR_SPEC: CommandSpec = {
  name: "clear",
  source: "builtin",
  help: { key: "chat.slash.help.clear" },
  subcommands: [],
};

export const MODEL_SPEC: CommandSpec = {
  name: "model",
  source: "builtin",
  help: { key: "chat.slash.help.model" },
  usage: "/model <id>",
  subcommands: [],
};

export const STATUS_SPEC: CommandSpec = {
  name: "status",
  source: "builtin",
  help: { key: "chat.slash.help.status" },
  subcommands: [],
};

export const SESSIONS_SPEC: CommandSpec = {
  name: "sessions",
  source: "builtin",
  help: { key: "chat.slash.help.sessions" },
  subcommands: [],
};

export const WORKSPACES_SPEC: CommandSpec = {
  name: "workspaces",
  source: "builtin",
  help: { key: "chat.slash.help.workspaces" },
  flag: "workspaces",
  subcommands: [
    { name: "list", usage: "/workspaces list", help: { key: "chat.slash.help.workspaces.list" } },
    { name: "new", usage: "/workspaces new <name> [-- <prompt>]", help: { key: "chat.slash.help.workspaces.new" } },
    { name: "switch", usage: "/workspaces switch <name>", help: { key: "chat.slash.help.workspaces.switch" } },
  ],
};

export const SKILLS_SPEC: CommandSpec = {
  name: "skills",
  source: "builtin",
  help: { key: "chat.slash.help.skills" },
  subcommands: [],
};

export const RESUME_SPEC: CommandSpec = {
  name: "resume",
  source: "builtin",
  help: { key: "chat.slash.help.resume" },
  usage: "/resume <id-prefix>",
  subcommands: [],
};

export const MEMORY_SPEC: CommandSpec = {
  name: "memory",
  source: "builtin",
  help: { key: "chat.slash.help.memory" },
  subcommands: [
    { name: "rm", usage: "/memory rm <id>", help: { key: "chat.slash.help.memory.rm" } },
    {
      name: "list",
      usage: "/memory list [all|user|project] [--archived]",
      help: { key: "chat.slash.help.memory.list" },
    },
  ],
};

export const USAGE_SPEC: CommandSpec = {
  name: "usage",
  source: "builtin",
  help: { key: "chat.slash.help.usage" },
  subcommands: [],
};

export const EXIT_SPEC: CommandSpec = {
  name: "exit",
  source: "builtin",
  help: { key: "chat.slash.help.exit" },
  subcommands: [],
};

/** The command's own argument form, or the list of subcommands it routes to. */
export function rootUsage(spec: CommandSpec): string {
  if (spec.usage) return spec.usage;
  if (spec.subcommands.length === 0) return `/${spec.name}`;
  return `/${spec.name} [${spec.subcommands.map((sub) => sub.name).join("|")}]`;
}

/** Every form the command accepts: its root, then each declared subcommand. */
export function fullUsage(spec: CommandSpec): string[] {
  return [rootUsage(spec), ...spec.subcommands.map((sub) => sub.usage)];
}

export function subcommandUsage(spec: CommandSpec, name: string): string {
  const sub = spec.subcommands.find((candidate) => candidate.name === name);
  if (!sub) throw new Error(`${spec.name} declares no subcommand ${name}`);
  return sub.usage;
}
