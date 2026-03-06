import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillLoadDiagnostics {
  scannedDirs: number;
  loaded: number;
  invalid: number;
  duplicates: number;
  readErrors: number;
  missingSkillFiles: number;
  scannedAt: string | null;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function createEmptySkillLoadDiagnostics(): SkillLoadDiagnostics {
  return {
    scannedDirs: 0,
    loaded: 0,
    invalid: 0,
    duplicates: 0,
    readErrors: 0,
    missingSkillFiles: 0,
    scannedAt: null,
  };
}

export function validateSkillName(name: string, dirName: string): string | null {
  if (name.length === 0 || name.length > 64) return `name must be 1-64 characters (got ${name.length})`;
  if (!SKILL_NAME_RE.test(name)) return `name contains invalid characters: "${name}"`;
  if (name.includes("--")) return `name must not contain consecutive hyphens: "${name}"`;
  if (name !== dirName) return `name "${name}" must match directory "${dirName}"`;
  return null;
}

function parseFrontmatter(input: string): ParsedFrontmatter | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("---")) return null;
  const lines = trimmed.split("\n");
  if (lines.length < 3 || lines[0].trim() !== "---") return null;
  const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIdx < 0) return null;

  const out: ParsedFrontmatter = {};
  let metadataMap: Record<string, string> | null = null;

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const isIndented = line.startsWith("  ") || line.startsWith("\t");

    // Indented lines belong to the current metadata map
    if (isIndented && metadataMap !== null) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line
          .slice(colonIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key && value) metadataMap[key] = value;
      }
      continue;
    }

    // Non-indented line — close any open metadata map
    metadataMap = null;

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
      case "license":
        if (value) out.license = value;
        break;
      case "compatibility":
        if (value) out.compatibility = value;
        break;
      case "allowed-tools":
        if (value) out.allowedTools = value.split(/\s+/).filter(Boolean);
        break;
      case "metadata":
        if (!value) {
          // Start collecting indented sub-keys
          metadataMap = {};
          out.metadata = metadataMap;
        }
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

async function scanSkills(cwd = process.cwd()): Promise<{ skills: SkillMeta[]; diagnostics: SkillLoadDiagnostics }> {
  const diagnostics = createEmptySkillLoadDiagnostics();
  const seen = new Set<string>();
  const found: SkillMeta[] = [];

  const root = join(cwd, SKILL_DIR);
  diagnostics.scannedAt = new Date().toISOString();
  if (!existsSync(root)) return { skills: [], diagnostics };

  let dirs: Dirent[];
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    diagnostics.readErrors += 1;
    return { skills: [], diagnostics };
  }

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    diagnostics.scannedDirs += 1;
    const dirName = entry.name as string;
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
        ...(fm.license ? { license: fm.license } : {}),
        ...(fm.compatibility ? { compatibility: fm.compatibility } : {}),
        ...(fm.metadata && Object.keys(fm.metadata).length > 0 ? { metadata: fm.metadata } : {}),
        ...(fm.allowedTools && fm.allowedTools.length > 0 ? { allowedTools: fm.allowedTools } : {}),
      });
    } catch {
      diagnostics.readErrors += 1;
      // Skip unreadable skills.
    }
  }

  found.sort((a, b) => a.name.localeCompare(b.name));
  diagnostics.loaded = found.length;
  return { skills: found, diagnostics };
}

export async function listSkills(cwd = process.cwd()): Promise<SkillMeta[]> {
  return (await scanSkills(cwd)).skills;
}

let cachedSkills: SkillMeta[] | null = null;
let cachedSkillDiagnostics: SkillLoadDiagnostics = createEmptySkillLoadDiagnostics();

export async function loadSkills(cwd?: string): Promise<SkillMeta[]> {
  const result = await scanSkills(cwd);
  cachedSkills = result.skills;
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
  const raw = await readFile(path, "utf8");
  const body = stripFrontmatter(raw);
  if (args !== undefined) return substituteArguments(body, args);
  return body;
}
