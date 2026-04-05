import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bundledSoul from "../docs/soul.md" with { type: "text" };

export function loadSoulPrompt(cwd = process.cwd()): string {
  const projectPath = join(cwd, "docs", "soul.md");
  if (existsSync(projectPath)) {
    try {
      const content = readFileSync(projectPath, "utf8").trim();
      if (content) return content;
    } catch {}
  }
  return (bundledSoul as string).trim();
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
