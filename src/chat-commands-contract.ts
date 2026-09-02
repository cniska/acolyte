import { z } from "zod";
import type { ChatRow } from "./chat-contract";
import type { Client } from "./client-contract";
import type { ConfigScope } from "./config-contract";
import type { FeatureFlagName } from "./feature-flags-contract";
import type { PlainTranslationKey } from "./i18n";
import type { listArchivedMemories, listMemories, removeMemory } from "./memory-ops";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";

export type CommandResult = {
  stop: boolean;
  userText: string;
};

export type CommandContext = {
  text: string;
  resolvedText: string;
  client: Client;
  sessionState: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
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
  resumeTranscript: (session: Session) => void;
  clearTranscript: (sessionId?: string) => void;
  tokenUsage: SessionTokenUsageEntry[];
  memoryApi?: Partial<{
    listMemories: typeof listMemories;
    removeMemory: typeof removeMemory;
    listArchivedMemories: typeof listArchivedMemories;
  }>;
};

export type ParsedCommand = {
  root: string;
  sub: string;
  args: string[];
  raw: string;
};

export function parseSlashCommand(text: string): ParsedCommand {
  const parts = text.trim().split(/\s+/);
  const root = (parts[0] ?? "").replace(/^\//, "");
  const sub = parts[1] ?? "";
  const args = parts.slice(2);
  return { root, sub, args, raw: text };
}

export const commandSourceSchema = z.enum(["builtin", "project", "user", "bundled", "plugin"]);
export type CommandSource = z.infer<typeof commandSourceSchema>;

/** A builtin's help is ours to translate; a skill's is the author's own description, carried verbatim. */
export type CommandHelp = { key: PlainTranslationKey } | { text: string };

export type SubcommandSpec = {
  name: string;
  usage: string;
  help: CommandHelp;
};

export type CommandSpec = {
  name: string;
  source: CommandSource;
  help: CommandHelp;
  flag?: FeatureFlagName;
  /** Argument form of the bare root. Absent means the root takes none, and extra tokens are not this command. */
  usage?: string;
  subcommands: SubcommandSpec[];
};

export type CommandHandler = (ctx: CommandContext, parsed: ParsedCommand) => Promise<CommandResult>;

export type CommandEntry = {
  spec: CommandSpec;
  /** Runs a bare root and any undeclared token, which arrives as the handler's first argument. */
  run: CommandHandler;
  runSub?: Record<string, CommandHandler>;
  /** A skill carries a prompt to the model; every other command is control and stops here. */
  isSkill?: boolean;
};
