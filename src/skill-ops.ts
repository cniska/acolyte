import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLED_SKILLS } from "./bundled-skills";
import { isBuiltinCommandName } from "./chat-command-specs";
import { readResolvedConfigSync } from "./config";
import { resolveHomeDir } from "./paths";
import { collectPluginSkills, loadPlugins } from "./plugin-ops";
import { createEmptySkillLoadDiagnostics, type SkillLoadDiagnostics, type SkillMeta } from "./skill-contract";
import { parseFrontmatter, scanSkillRoot, stripFrontmatter } from "./skill-scan";

const SKILL_DIR = ".agents/skills";

/** `~/.agents/skills` stays outside the XDG layout so global skills are shared with every agent reading that convention. */
async function scanSkills(cwd = process.cwd()): Promise<{ skills: SkillMeta[]; diagnostics: SkillLoadDiagnostics }> {
  const diagnostics = createEmptySkillLoadDiagnostics();
  const seen = new Set<string>();
  const found: SkillMeta[] = [];
  diagnostics.scannedAt = new Date().toISOString();

  await scanSkillRoot({ root: join(cwd, SKILL_DIR), source: "project" }, found, seen, diagnostics);
  await scanSkillRoot({ root: join(resolveHomeDir(), SKILL_DIR), source: "user" }, found, seen, diagnostics);

  found.sort((a, b) => a.name.localeCompare(b.name));
  diagnostics.loaded = found.length;
  return { skills: found, diagnostics };
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

/**
 * Resolves the roster across every source: a hand-placed skill outranks one that arrived inside a
 * plugin, which outranks a bundled skill. Only hand-placed skills may claim a built-in command name.
 */
export function mergeSkills(
  bundled: SkillMeta[],
  plugin: SkillMeta[],
  scanned: SkillMeta[],
  diagnostics: SkillLoadDiagnostics,
): SkillMeta[] {
  const claimed = new Set(scanned.map((s) => s.name));

  const pluginKept: SkillMeta[] = [];
  for (const skill of plugin) {
    if (claimed.has(skill.name) || isBuiltinCommandName(skill.name)) {
      diagnostics.duplicates += 1;
      continue;
    }
    claimed.add(skill.name);
    pluginKept.push(skill);
  }

  const unshadowed = bundled.filter((s) => !claimed.has(s.name));
  diagnostics.overrides = bundled.length - unshadowed.length;
  // A bundled name colliding with a builtin is a packaging mistake, not user authority.
  const kept = unshadowed.filter((s) => !isBuiltinCommandName(s.name));
  diagnostics.builtinCollisions = unshadowed.length - kept.length;

  const merged = [...scanned, ...pluginKept, ...kept];
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

let cachedSkills: SkillMeta[] | null = null;
let cachedSkillDiagnostics: SkillLoadDiagnostics = createEmptySkillLoadDiagnostics();

function pluginsEnabled(cwd?: string): boolean {
  try {
    return readResolvedConfigSync({ cwd }).features.plugins;
  } catch {
    return false;
  }
}

export async function loadSkills(cwd?: string): Promise<SkillMeta[]> {
  const result = await scanSkills(cwd);
  const pluginSkills = pluginsEnabled(cwd) ? collectPluginSkills((await loadPlugins(cwd)).plugins) : [];
  cachedSkills = mergeSkills(loadBundledSkills().skills, pluginSkills, result.skills, result.diagnostics);
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
