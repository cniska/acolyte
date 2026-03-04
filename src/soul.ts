import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listMemories } from "./memory";

const MEMORY_CONTEXT_LIMIT = 8;
type PromptLoadOptions = {
  cwd?: string;
  homeDir?: string;
};
export type MemoryContextScope = "all" | "user" | "project";

export function loadSoulPrompt(cwd = process.cwd()): string {
  const soulPath = join(cwd, "docs", "soul.md");
  if (!existsSync(soulPath)) return "";

  try {
    const content = readFileSync(soulPath, "utf8").trim();
    return content;
  } catch {
    return "";
  }
}

export function loadAgentsPrompt(cwd = process.cwd()): string {
  const agentsPath = join(cwd, "AGENTS.md");
  if (!existsSync(agentsPath)) return "";

  try {
    const content = readFileSync(agentsPath, "utf8").trim();
    if (content.length === 0) return "";
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
  if (top.length === 0) return "";
  const lines = top.map((entry) => `- ${entry.content}`);
  return `User memory context:\n${lines.join("\n")}`;
}

export async function createSoulPrompt(options: PromptLoadOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const base = loadSystemPrompt(cwd);
  const memoryContext = await loadMemoryContextPrompt(options);
  if (!memoryContext) return base;
  return `${base}\n\n${memoryContext}`;
}
