import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bundledSoul from "../docs/soul.md" with { type: "text" };

export type SoulPromptOptions = {
  cwd?: string;
};

export function loadSoulPrompt(): string {
  return (bundledSoul as string).trim();
}

export function loadProjectRulesPrompt(cwd = process.cwd()): string {
  const agentsPath = join(cwd, "AGENTS.md");
  if (!existsSync(agentsPath)) return "";

  try {
    const content = readFileSync(agentsPath, "utf8").trim();
    if (content.length === 0) return "";
    return ["Project rules (AGENTS.md):", content].join("\n");
  } catch {
    return "";
  }
}

export const loadAgentsPrompt = loadProjectRulesPrompt;

export async function createSoulPrompt(options: SoulPromptOptions = {}): Promise<string> {
  void options;
  return loadSoulPrompt();
}
