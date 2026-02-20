import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FALLBACK_SOUL =
  "You are Acolyte, a pragmatic personal coding assistant. Be concise, accurate, and action-oriented.";

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
