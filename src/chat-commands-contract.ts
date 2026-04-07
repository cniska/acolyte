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
