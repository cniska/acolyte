import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export async function createSoulPrompt(options: { cwd?: string } = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  return loadSystemPrompt(cwd);
}
