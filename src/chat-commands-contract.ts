import type { ChatRow } from "./chat-contract";
import type { Client } from "./client-contract";
import type { ConfigScope } from "./config-contract";
import type { addMemory, listMemories, removeMemory } from "./memory-ops";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";

export type CommandResult = {
  stop: boolean;
  userText: string;
};

export type CommandContext = {
  text: string;
  resolvedText: string;
  client: Client;
  store: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  toRows: (messages: Session["messages"]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowHelp: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: () => void | Promise<void>;
  persistModelConfig?: (key: string, value: string, scope: ConfigScope) => Promise<void>;
  activateSkill?: (skillName: string, args: string) => Promise<boolean>;
  startAssistantTurn?: (userText: string) => Promise<void>;
  clearTranscript: (sessionId?: string) => void;
  tokenUsage: SessionTokenUsageEntry[];
  memoryApi?: {
    listMemories: typeof listMemories;
    addMemory: typeof addMemory;
    removeMemory: typeof removeMemory;
  };
};

export type SlashCommand = {
  name: string;
  match: (value: string) => boolean;
  run: () => Promise<CommandResult>;
};

export type ParsedCommand = {
  root: string;
  sub: string;
  args: string[];
  raw: string;
};

export type Subcommand = {
  name: string;
  match: (sub: string, args: string[]) => boolean;
  run: (parsed: ParsedCommand) => Promise<CommandResult>;
};

export type SubcommandGroup = {
  root: string;
  subcommands: Subcommand[];
  fallback: (parsed: ParsedCommand) => Promise<CommandResult>;
};

export function parseSlashCommand(text: string): ParsedCommand {
  const parts = text.trim().split(/\s+/);
  const root = (parts[0] ?? "").replace(/^\//, "");
  const sub = parts[1] ?? "";
  const args = parts.slice(2);
  return { root, sub, args, raw: text };
}

export function dispatchSubcommandGroup(group: SubcommandGroup, text: string): Promise<CommandResult> {
  const parsed = parseSlashCommand(text);
  for (const sub of group.subcommands) {
    if (sub.match(parsed.sub, parsed.args)) return sub.run(parsed);
  }
  return group.fallback(parsed);
}
