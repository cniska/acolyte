import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole } from "./agent-roles";
import { listMemories } from "./memory";

const FALLBACK_SOUL =
  "You are Acolyte, a pragmatic personal coding assistant. Be concise, accurate, and action-oriented.";
const MEMORY_CONTEXT_LIMIT = 8;
type PromptLoadOptions = {
  cwd?: string;
  homeDir?: string;
};
export type MemoryContextScope = "all" | "user" | "project";

export function loadSoulPrompt(cwd = process.cwd()): string {
  const soulPath = join(cwd, "docs", "soul.md");
  if (!existsSync(soulPath)) {
    return FALLBACK_SOUL;
  }

  try {
    const content = readFileSync(soulPath, "utf8").trim();
    return content.length > 0 ? content : FALLBACK_SOUL;
  } catch {
    return FALLBACK_SOUL;
  }
}

const FALLBACK_ROLE_SOUL: Record<AgentRole, string> = {
  planner: "Role: planner. Produce concise, sequenced plans with risks and validation checkpoints.",
  coder: "Role: coder. Focus on practical implementation and compact, execution-oriented responses.",
  reviewer: "Role: reviewer. Prioritize concrete findings with evidence and concise remediation guidance.",
};

export function loadRoleSoulPrompt(role: AgentRole, cwd = process.cwd()): string {
  const roleSoulPath = join(cwd, "docs", "souls", `${role}.md`);
  if (!existsSync(roleSoulPath)) {
    return FALLBACK_ROLE_SOUL[role];
  }
  try {
    const content = readFileSync(roleSoulPath, "utf8").trim();
    return content.length > 0 ? content : FALLBACK_ROLE_SOUL[role];
  } catch {
    return FALLBACK_ROLE_SOUL[role];
  }
}

export function loadAgentsPrompt(cwd = process.cwd()): string {
  const agentsPath = join(cwd, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    return "";
  }

  try {
    const content = readFileSync(agentsPath, "utf8").trim();
    if (content.length === 0) {
      return "";
    }
    return ["Repository Instructions (AGENTS.md):", content].join("\n");
  } catch {
    return "";
  }
}

export function loadSystemPrompt(cwd = process.cwd()): string {
  const soul = loadSoulPrompt(cwd);
  const agents = loadAgentsPrompt(cwd);
  return agents ? `${soul}\n\n${agents}` : soul;
}

type MemoryContextLoadOptions = PromptLoadOptions & {
  scope?: MemoryContextScope;
};

export async function getMemoryContextEntries(options: MemoryContextLoadOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scope = options.scope ?? "all";
  const memories = await listMemories({ cwd, homeDir: options.homeDir, scope });
  return memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MEMORY_CONTEXT_LIMIT);
}

export async function loadMemoryContextPrompt(options: PromptLoadOptions = {}): Promise<string> {
  const top = await getMemoryContextEntries(options);
  if (top.length === 0) {
    return "";
  }
  const lines = top.map((entry) => `- ${entry.content}`);
  return `User memory context:\n${lines.join("\n")}`;
}

export async function createSoulPrompt(options: PromptLoadOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const base = loadSystemPrompt(cwd);
  const memoryContext = await loadMemoryContextPrompt(options);
  if (!memoryContext) {
    return base;
  }
  return `${base}\n\n${memoryContext}`;
}

export async function createRoleSoulPrompt(role: AgentRole, options: PromptLoadOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const core = await createSoulPrompt(options);
  const roleSoul = loadRoleSoulPrompt(role, cwd);
  return `${core}\n\n${roleSoul}`;
}
