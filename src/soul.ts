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
