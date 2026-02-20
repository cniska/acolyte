import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

function parseFrontmatter(input: string): Record<string, string> | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("---")) {
    return null;
  }
  const lines = trimmed.split("\n");
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return null;
  }
  const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIdx < 0) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const line of lines.slice(1, endIdx)) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) {
      out[key] = value;
    }
  }
  return out;
}

export async function listSkills(cwd = process.cwd()): Promise<SkillMeta[]> {
  const root = join(cwd, "skills");
  if (!existsSync(root)) {
    return [];
  }

  const dirs = await readdir(root, { withFileTypes: true });
  const found: SkillMeta[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) {
      continue;
    }
    const skillPath = join(root, dir.name, "SKILL.md");
    if (!existsSync(skillPath)) {
      continue;
    }
    try {
      const content = await readFile(skillPath, "utf8");
      const fm = parseFrontmatter(content) ?? {};
      const name = fm.name ?? dir.name;
      const description = fm.description ?? "No description";
      found.push({ name, description, path: skillPath });
    } catch {
      // Ignore malformed/unreadable skills for now.
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

