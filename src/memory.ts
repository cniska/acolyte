import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryScope = "user" | "project";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
  scope: MemoryScope;
}

export interface MemoryOptions {
  scope?: MemoryScope | "all";
  cwd?: string;
  homeDir?: string;
}

export type RemoveMemoryResult =
  | { kind: "removed"; entry: MemoryEntry }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: MemoryEntry[] };

function getUserMemoryDir(homeDir = homedir()): string {
  return join(homeDir, ".acolyte", "memory", "user");
}

function getProjectMemoryDir(cwd = process.cwd()): string {
  return join(cwd, ".acolyte", "memory", "project");
}

function serializeMemory(entry: MemoryEntry): string {
  return [
    "---",
    `id: ${entry.id}`,
    `createdAt: ${entry.createdAt}`,
    `scope: ${entry.scope}`,
    "---",
    entry.content,
    "",
  ].join("\n");
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const metaLines = match[1].split("\n");
  const meta: Record<string, string> = {};
  for (const line of metaLines) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

async function readMemoryDir(dir: string, scope: MemoryScope): Promise<MemoryEntry[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const names = await readdir(dir);
  const entries: MemoryEntry[] = [];

  for (const name of names) {
    if (!name.endsWith(".md")) {
      continue;
    }
    const path = join(dir, name);
    try {
      const raw = await readFile(path, "utf8");
      const parsed = parseFrontmatter(raw);
      if (!parsed) {
        continue;
      }
      const id = parsed.meta.id?.trim();
      const createdAt = parsed.meta.createdAt?.trim();
      const content = parsed.body.trim();
      if (!id || !createdAt || !content) {
        continue;
      }
      entries.push({
        id,
        createdAt,
        content,
        scope,
      });
    } catch {
      // Ignore unreadable memory files.
    }
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope = "all", cwd = process.cwd(), homeDir = homedir() } = options;

  const includeProject = scope === "all" || scope === "project";
  const includeUser = scope === "all" || scope === "user";

  const projectEntries = includeProject ? await readMemoryDir(getProjectMemoryDir(cwd), "project") : [];
  const userEntries = includeUser ? await readMemoryDir(getUserMemoryDir(homeDir), "user") : [];

  return [...projectEntries, ...userEntries];
}

export async function addMemory(
  content: string,
  options: Omit<MemoryOptions, "scope"> & { scope?: MemoryScope } = {},
): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Memory content cannot be empty");
  }

  const { scope = "user", cwd = process.cwd(), homeDir = homedir() } = options;
  const dir = scope === "project" ? getProjectMemoryDir(cwd) : getUserMemoryDir(homeDir);
  await mkdir(dir, { recursive: true });

  const entry: MemoryEntry = {
    id: `mem_${crypto.randomUUID()}`,
    content: trimmed,
    createdAt: new Date().toISOString(),
    scope,
  };
  const filename = `${entry.id}.md`;
  await writeFile(join(dir, filename), serializeMemory(entry), "utf8");
  return entry;
}

export async function removeMemoryByPrefix(
  prefix: string,
  options: Omit<MemoryOptions, "scope"> & { scope?: MemoryScope | "all" } = {},
): Promise<RemoveMemoryResult> {
  const trimmed = prefix.trim();
  if (!trimmed) {
    throw new Error("Memory id prefix cannot be empty");
  }
  const matches = (await listMemories(options)).filter((entry) => entry.id.startsWith(trimmed));
  if (matches.length === 0) {
    return { kind: "not_found", prefix: trimmed };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", prefix: trimmed, matches };
  }
  const entry = matches[0];
  const { cwd = process.cwd(), homeDir = homedir() } = options;
  const dir = entry.scope === "project" ? getProjectMemoryDir(cwd) : getUserMemoryDir(homeDir);
  await rm(join(dir, `${entry.id}.md`), { force: true });
  return { kind: "removed", entry };
}
