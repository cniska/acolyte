import { type Dirent, existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLED_SKILLS } from "./bundled-skills";
import { isBuiltinCommandName } from "./chat-command-specs";
import { resolveHomeDir } from "./paths";
import {
  createEmptySkillLoadDiagnostics,
  type SkillLoadDiagnostics,
  type SkillMeta,
  type SkillSource,
  validateSkillName,
} from "./skill-contract";

type ParsedFrontmatter = {
  name?: string;
  description?: string;
};

function parseFrontmatter(input: string): ParsedFrontmatter | null {
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

function stripFrontmatter(input: string): string {
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

const SKILL_DIR = ".agents/skills";

/** `~/.agents/skills` stays outside the XDG layout so global skills are shared with every agent reading that convention. */
async function scanSkills(cwd = process.cwd()): Promise<{ skills: SkillMeta[]; diagnostics: SkillLoadDiagnostics }> {
  const diagnostics = createEmptySkillLoadDiagnostics();
  const seen = new Set<string>();
  const found: SkillMeta[] = [];
  diagnostics.scannedAt = new Date().toISOString();

  await scanSkillRoot(join(cwd, SKILL_DIR), "project", found, seen, diagnostics);
  await scanSkillRoot(join(resolveHomeDir(), SKILL_DIR), "user", found, seen, diagnostics);

  found.sort((a, b) => a.name.localeCompare(b.name));
  diagnostics.loaded = found.length;
  return { skills: found, diagnostics };
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

async function scanSkillRoot(
  root: string,
  source: Extract<SkillSource, "project" | "user">,
  found: SkillMeta[],
  seen: Set<string>,
  diagnostics: SkillLoadDiagnostics,
): Promise<void> {
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
      });
    } catch {
      diagnostics.readErrors += 1;
      // Skip unreadable skills.
    }
  }
}

let bundledSkillCache: { skills: SkillMeta[]; contentByName: Map<string, string> } | null = null;

function loadBundledSkills(): { skills: SkillMeta[]; contentByName: Map<string, string> } {
  if (bundledSkillCache) return bundledSkillCache;
  const skills: SkillMeta[] = [];
  const contentByName = new Map<string, string>();
  for (const bundled of BUNDLED_SKILLS) {
    const fm = parseFrontmatter(bundled.content);
    const description = fm?.description ?? "";
    const body = stripFrontmatter(bundled.content);
    contentByName.set(bundled.name, body);
    skills.push({
      name: bundled.name,
      description,
      path: `bundled://${bundled.name}`,
      source: "bundled",
    });
  }
  bundledSkillCache = { skills, contentByName };
  return bundledSkillCache;
}

function mergeSkills(bundled: SkillMeta[], scanned: SkillMeta[], diagnostics: SkillLoadDiagnostics): SkillMeta[] {
  const scannedNames = new Set(scanned.map((s) => s.name));
  const unshadowed = bundled.filter((s) => !scannedNames.has(s.name));
  diagnostics.overrides = bundled.length - unshadowed.length;
  // A bundled name colliding with a builtin is a packaging mistake, not user authority.
  const kept = unshadowed.filter((s) => !isBuiltinCommandName(s.name));
  diagnostics.builtinCollisions = unshadowed.length - kept.length;
  const merged = [...scanned, ...kept];
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

let cachedSkills: SkillMeta[] | null = null;
let cachedSkillDiagnostics: SkillLoadDiagnostics = createEmptySkillLoadDiagnostics();

export async function loadSkills(cwd?: string): Promise<SkillMeta[]> {
  const result = await scanSkills(cwd);
  cachedSkills = mergeSkills(loadBundledSkills().skills, result.skills, result.diagnostics);
  cachedSkillDiagnostics = result.diagnostics;
  return cachedSkills;
}

export function getLoadedSkills(): SkillMeta[] {
  return cachedSkills ?? [];
}

export function getSkillLoadDiagnostics(): SkillLoadDiagnostics {
  return cachedSkillDiagnostics;
}

export function findSkillByName(name: string): SkillMeta | undefined {
  return getLoadedSkills().find((s) => s.name === name);
}

export function resetSkillCache(): void {
  cachedSkills = null;
  cachedSkillDiagnostics = createEmptySkillLoadDiagnostics();
}

export function substituteArguments(body: string, args: string): string {
  return body.replaceAll("$ARGUMENTS", args);
}

export async function readSkillInstructions(path: string, args?: string): Promise<string> {
  let body: string;
  if (path.startsWith("bundled://")) {
    const name = path.slice("bundled://".length);
    const content = loadBundledSkills().contentByName.get(name);
    if (!content) throw new Error(`bundled skill not found: ${name}`);
    body = content;
  } else {
    const raw = await readFile(path, "utf8");
    body = stripFrontmatter(raw);
  }
  if (args !== undefined) return substituteArguments(body, args);
  return body;
}
