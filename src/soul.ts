import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bundledSoul from "../docs/soul.md" with { type: "text" };

export type SoulPromptOptions = {
  cwd?: string;
  includeAgents?: boolean;
  agentsHint?: "none" | "memory";
};

export function loadSoulPrompt(): string {
  return (bundledSoul as string).trim();
}

export function loadAgentsPrompt(cwd = process.cwd()): string {
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

export function loadSystemPrompt(cwd = process.cwd(), options: Omit<SoulPromptOptions, "cwd"> = {}): string {
  const soul = loadSoulPrompt();
  const includeAgents = options.includeAgents ?? true;
  const agents = includeAgents ? loadAgentsPrompt(cwd) : "";
  if (agents) return `${soul}\n\n${agents}`;

  if (options.agentsHint === "memory") {
    return `${soul}\n\nProject rules are available via project memory. Use memory-search to retrieve them when needed.`;
  }

  return soul;
}

export async function createSoulPrompt(options: SoulPromptOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  return loadSystemPrompt(cwd, options);
}
