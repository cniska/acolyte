import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
