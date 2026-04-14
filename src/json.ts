import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function readJson(workspace: string, name: string): Record<string, unknown> | null {
  try {
    const path = join(workspace, name);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return JSON.parse(name.endsWith("c") ? stripJsonComments(raw) : raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
