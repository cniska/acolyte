import { type Dirent, existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillLoadDiagnostics, SkillMeta, SkillSource } from "./skill-contract";
import { validateSkillName } from "./skill-contract";

export type ParsedFrontmatter = {
  name?: string;
  description?: string;
};

export function parseFrontmatter(input: string): ParsedFrontmatter | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("---")) return null;
  const lines = trimmed.split("\n");
  if (lines.length < 3 || lines[0].trim() !== "---") return null;
  const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIdx < 0) return null;

  const out: ParsedFrontmatter = {};

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    switch (key) {
      case "name":
        if (value) out.name = value;
        break;
      case "description":
        if (value) out.description = value;
        break;
    }
  }

  return out;
}

export function stripFrontmatter(input: string): string {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("---")) return input.trim();
  const lines = trimmed.split("\n");
  if (lines.length < 3 || lines[0].trim() !== "---") return input.trim();
  const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIdx < 0) return input.trim();
  return lines
    .slice(endIdx + 1)
    .join("\n")
    .trim();
}

/** `readdir` reports a symlinked directory as a link, and populating a skill root by symlink is a supported layout. */
function isSkillDir(root: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(root, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

export type SkillScanTarget = {
  root: string;
  source: SkillSource;
  plugin?: string;
};

/**
 * Discovers skills in the immediate children of one root, never deeper. Shared by `.agents/skills`
 * scopes and by plugins so every `SKILL.md` on disk is read through the same rules.
 */
export async function scanSkillRoot(
  target: SkillScanTarget,
  found: SkillMeta[],
  seen: Set<string>,
  diagnostics: SkillLoadDiagnostics,
): Promise<void> {
  const { root, source, plugin } = target;
  if (!existsSync(root)) return;

  let dirs: Dirent[];
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    diagnostics.readErrors += 1;
    return;
  }

  for (const entry of dirs) {
    if (!isSkillDir(root, entry)) continue;
    diagnostics.scannedDirs += 1;
    const dirName = entry.name;
    const skillPath = join(root, dirName, "SKILL.md");
    if (!existsSync(skillPath)) {
      diagnostics.missingSkillFiles += 1;
      continue;
    }
    try {
      const content = await readFile(skillPath, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) {
        diagnostics.invalid += 1;
        continue;
      }
      const name = fm.name ?? dirName;
      const nameError = validateSkillName(name, dirName);
      if (nameError) {
        diagnostics.invalid += 1;
        continue;
      }
      if (seen.has(name)) {
        diagnostics.duplicates += 1;
        continue;
      }
      seen.add(name);

      const description = fm.description;
      if (!description || description.length > 1024) {
        diagnostics.invalid += 1;
        continue;
      }

      found.push({
        name,
        description,
        path: skillPath,
        source,
        ...(plugin ? { plugin } : {}),
      });
    } catch {
      diagnostics.readErrors += 1;
      // Skip unreadable skills.
    }
  }
}
