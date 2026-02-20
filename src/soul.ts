import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listMemories } from "./memory";

const FALLBACK_SOUL =
  "You are Acolyte, a pragmatic personal coding assistant. Be concise, accurate, and action-oriented.";
const MEMORY_CONTEXT_LIMIT = 8;
type PromptLoadOptions = {
  cwd?: string;
  homeDir?: string;
};

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

export async function loadMemoryContextPrompt(options: PromptLoadOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const memories = await listMemories({ cwd, homeDir: options.homeDir, scope: "all" });
  const top = memories.slice(0, MEMORY_CONTEXT_LIMIT);
  if (top.length === 0) {
    return "";
  }
  const lines = top.map((entry) => `- ${entry.content}`);
  return `User memory context:\n${lines.join("\n")}`;
}

export async function loadSystemPromptWithMemories(options: PromptLoadOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const base = loadSystemPrompt(cwd);
  const memoryContext = await loadMemoryContextPrompt(options);
  if (!memoryContext) {
    return base;
  }
  return `${base}\n\n${memoryContext}`;
}
