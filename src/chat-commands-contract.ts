import { z } from "zod";
import type { ChatRow } from "./chat-contract";
import type { Client } from "./client-contract";
import type { ConfigScope } from "./config-contract";
import { featureFlagNameSchema } from "./feature-flags-contract";
import type { addMemory, listArchivedMemories, listMemories, removeMemory } from "./memory-ops";
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
    addMemory: typeof addMemory;
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

export const commandSourceSchema = z.enum(["builtin", "project", "user", "bundled"]);

export const subcommandSpecSchema = z.object({
  name: z.string(),
  usage: z.string(),
  helpKey: z.string(),
});

export const commandSpecSchema = z.object({
  name: z.string(),
  source: commandSourceSchema,
  helpKey: z.string(),
  flag: featureFlagNameSchema.optional(),
  /** Argument form of the bare root. Absent means the root takes none, and extra tokens are not this command. */
  usage: z.string().optional(),
  subcommands: z.array(subcommandSpecSchema),
});
export type CommandSpec = z.infer<typeof commandSpecSchema>;

export type CommandHandler = (ctx: CommandContext, parsed: ParsedCommand) => Promise<CommandResult>;

export type CommandEntry = {
  spec: CommandSpec;
  /** Runs a bare root and any undeclared token, which arrives as the handler's first argument. */
  run: CommandHandler;
  runSub?: Record<string, CommandHandler>;
};
