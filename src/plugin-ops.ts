import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { log } from "./log";
import type { McpServerConfig } from "./mcp-contract";
import { dataDir, resolveHomeDir } from "./paths";
import {
  AGENT_PLUGINS_VERSION,
  createEmptyPluginLoadDiagnostics,
  declaredSchemaVersion,
  isUsableExtensions,
  normalizePluginMcpServer,
  PLUGIN_DIR,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_MCP_FILE,
  PLUGIN_SKILLS_DIR,
  type PluginFaultKind,
  type PluginLoadDiagnostics,
  type PluginMeta,
  type PluginPaths,
  type PluginScope,
  pluginManifestSchema,
  pluginMcpFileSchema,
  qualifyPluginServerName,
  unknownManifestFields,
} from "./plugin-contract";
import { createEmptySkillLoadDiagnostics, type SkillMeta } from "./skill-contract";
import { scanSkillRoot } from "./skill-scan";

const PROJECT_PLUGIN_DATA_DIR = ".acolyte/plugin-data";

function resolvePluginDataDir(name: string, scope: PluginScope, cwd: string): string {
  if (scope === "project") return join(cwd, PROJECT_PLUGIN_DATA_DIR, name);
  return join(dataDir(), "plugins", name);
}

function fault(kind: PluginFaultKind, root: string, detail?: string): void {
  log.warn("plugin.rejected", { kind, root, ...(detail ? { detail } : {}) });
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolves the deepest existing ancestor through the filesystem and re-appends the rest, so a
 * containment check sees where a path really lands even when its leaf does not exist yet.
 */
function resolveRealPath(target: string): string {
  const trailing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return join(realpathSync(current), ...trailing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      trailing.unshift(basename(current));
      current = parent;
    }
  }
}

function isPluginDir(root: string, name: string): boolean {
  try {
    return statSync(join(root, name)).isDirectory();
  } catch {
    return false;
  }
}

async function loadPluginMcpServers(
  root: string,
  paths: PluginPaths,
  pluginName: string,
  diagnostics: PluginLoadDiagnostics,
): Promise<Record<string, McpServerConfig>> {
  const mcpPath = join(root, PLUGIN_MCP_FILE);
  if (!existsSync(mcpPath)) return {};

  const raw = await readJsonFile(mcpPath);
  if (!raw) {
    diagnostics.mcpDisabled += 1;
    fault("mcp-unreadable", root);
    return {};
  }

  const parsed = pluginMcpFileSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.mcpDisabled += 1;
    const version = declaredSchemaVersion(raw.$schema);
    fault(version ? "mcp-version-unsupported" : "mcp-invalid", root, version ?? undefined);
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [serverName, entry] of Object.entries(parsed.data.mcpServers)) {
    const normalized = normalizePluginMcpServer(entry, paths, resolveRealPath);
    if (!normalized.ok) {
      diagnostics.skippedServers += 1;
      fault(normalized.kind, root, serverName);
      continue;
    }
    servers[qualifyPluginServerName(pluginName, serverName)] = normalized.server;
  }
  return servers;
}

type PluginScan = {
  cwd: string;
  plugins: PluginMeta[];
  seenNames: Set<string>;
  seenSkills: Set<string>;
  diagnostics: PluginLoadDiagnostics;
};

async function loadPlugin(scope: PluginScope, dirPath: string, scan: PluginScan): Promise<PluginMeta | null> {
  const { seenNames, seenSkills, diagnostics } = scan;
  const manifestPath = join(dirPath, PLUGIN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    diagnostics.missingManifests += 1;
    return null;
  }

  const raw = await readJsonFile(manifestPath);
  if (!raw) {
    diagnostics.rejected += 1;
    fault("manifest-unreadable", dirPath);
    return null;
  }

  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.rejected += 1;
    const version = declaredSchemaVersion(raw.$schema);
    const unsupported = version !== null && version !== AGENT_PLUGINS_VERSION;
    fault(unsupported ? "manifest-version-unsupported" : "manifest-invalid", dirPath, version ?? undefined);
    return null;
  }

  if (raw.extensions !== undefined && !isUsableExtensions(raw.extensions)) {
    log.warn("plugin.manifest.extensions_ignored", { root: dirPath });
  }

  const unknown = unknownManifestFields(raw);
  if (unknown.length > 0) {
    diagnostics.unknownFields += unknown.length;
    log.warn("plugin.manifest.unknown_fields", { root: dirPath, fields: unknown.join(",") });
  }

  const manifest = parsed.data;
  if (seenNames.has(manifest.name)) {
    diagnostics.duplicates += 1;
    fault("duplicate-name", dirPath, manifest.name);
    return null;
  }
  seenNames.add(manifest.name);

  // Containment checks are meaningless on an unresolved path, and the spec resolves the plugin root through the filesystem.
  const root = await realpath(dirPath).catch(() => dirPath);
  const pluginDataDir = resolvePluginDataDir(manifest.name, scope, scan.cwd);
  const paths: PluginPaths = { root, dataDir: pluginDataDir };

  const skills: SkillMeta[] = [];
  const skillFaults = createEmptySkillLoadDiagnostics();
  await scanSkillRoot(
    { root: join(root, PLUGIN_SKILLS_DIR), source: "plugin", plugin: manifest.name },
    skills,
    seenSkills,
    skillFaults,
  );
  diagnostics.skillsInvalid += skillFaults.invalid + skillFaults.readErrors + skillFaults.missingSkillFiles;
  diagnostics.skillsDuplicates += skillFaults.duplicates;

  const mcpServers = await loadPluginMcpServers(root, paths, manifest.name, diagnostics);

  diagnostics.loaded += 1;
  diagnostics.skills += skills.length;
  diagnostics.servers += Object.keys(mcpServers).length;

  return {
    name: manifest.name,
    scope,
    root,
    dataDir: pluginDataDir,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    skills,
    mcpServers,
  };
}

async function scanPluginRoot(root: string, scope: PluginScope, scan: PluginScan): Promise<void> {
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const name of entries.sort()) {
    if (!isPluginDir(root, name)) continue;
    scan.diagnostics.scannedDirs += 1;
    const plugin = await loadPlugin(scope, join(root, name), scan);
    if (plugin) scan.plugins.push(plugin);
  }
}

export type PluginScanResult = {
  plugins: PluginMeta[];
  diagnostics: PluginLoadDiagnostics;
};

/** A project plugin shadows a user plugin of the same name, matching how skill scopes resolve. */
export async function scanPlugins(cwd = process.cwd()): Promise<PluginScanResult> {
  const diagnostics = createEmptyPluginLoadDiagnostics();
  diagnostics.scannedAt = new Date().toISOString();

  const scan: PluginScan = {
    cwd,
    plugins: [],
    seenNames: new Set<string>(),
    seenSkills: new Set<string>(),
    diagnostics,
  };

  await scanPluginRoot(join(cwd, PLUGIN_DIR), "project", scan);
  await scanPluginRoot(join(resolveHomeDir(), PLUGIN_DIR), "user", scan);

  return { plugins: scan.plugins, diagnostics };
}

let cachedDiagnostics: PluginLoadDiagnostics = createEmptyPluginLoadDiagnostics();

export async function loadPlugins(cwd?: string): Promise<PluginScanResult> {
  const result = await scanPlugins(cwd);
  cachedDiagnostics = result.diagnostics;
  return result;
}

export function getPluginLoadDiagnostics(): PluginLoadDiagnostics {
  return cachedDiagnostics;
}

export function resetPluginCache(): void {
  cachedDiagnostics = createEmptyPluginLoadDiagnostics();
}

export function collectPluginSkills(plugins: PluginMeta[]): SkillMeta[] {
  return plugins.flatMap((plugin) => plugin.skills);
}

export function collectPluginMcpServers(plugins: PluginMeta[]): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const plugin of plugins) {
    Object.assign(servers, plugin.mcpServers);
  }
  return servers;
}

/** The spec requires the data directory to exist before a plugin subprocess launches; nothing else creates it. */
export async function ensurePluginDataDirs(plugins: PluginMeta[]): Promise<void> {
  for (const plugin of plugins) {
    if (Object.keys(plugin.mcpServers).length === 0) continue;
    await mkdir(plugin.dataDir, { recursive: true }).catch((error) => {
      log.warn("plugin.data_dir.failed", { plugin: plugin.name, error: String(error) });
    });
  }
}
