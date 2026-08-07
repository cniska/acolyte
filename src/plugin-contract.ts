import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { type McpServerConfig, mcpServerSchema } from "./mcp-contract";
import { skillMetaSchema } from "./skill-contract";

export const AGENT_PLUGINS_VERSION = "1.0.0";
export const PLUGIN_MANIFEST_SCHEMA_ID = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
export const PLUGIN_MCP_SCHEMA_ID = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`;

export const PLUGIN_DIR = ".agents/plugins";
export const PLUGIN_MANIFEST_FILE = "plugin.json";
export const PLUGIN_MCP_FILE = "mcp.json";
export const PLUGIN_SKILLS_DIR = "skills";

export const PLUGIN_ROOT_VAR = "PLUGIN_ROOT";
export const PLUGIN_DATA_VAR = "PLUGIN_DATA";

const PLUGIN_NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export function validatePluginName(name: string): string | null {
  if (name.length === 0 || name.length > 64) return `name must be 1-64 characters (got ${name.length})`;
  if (!PLUGIN_NAME_RE.test(name)) return `name contains invalid characters: "${name}"`;
  if (name.includes("--")) return `name must not contain consecutive hyphens: "${name}"`;
  if (name.includes("..")) return `name must not contain consecutive periods: "${name}"`;
  return null;
}

export const pluginNameSchema = z.string().refine((name) => validatePluginName(name) === null, {
  message: "invalid plugin name",
});

export const pluginAuthorSchema = z.strictObject({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
});

export const pluginManifestSchema = z.object({
  $schema: z.literal(PLUGIN_MANIFEST_SCHEMA_ID),
  name: pluginNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  author: pluginAuthorSchema.optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** A non-object `extensions` is reported and ignored rather than rejecting the plugin, so the shape stays unconstrained here. */
  extensions: z.unknown().optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function isUsableExtensions(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MANIFEST_FIELDS = new Set(Object.keys(pluginManifestSchema.shape));

/** The spec exempts unknown top-level manifest fields from the reject-on-violation rule: report them, then keep loading. */
export function unknownManifestFields(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((key) => !MANIFEST_FIELDS.has(key));
}

const SCHEMA_ID_RE = /^https:\/\/agent-plugins\.org\/schemas\/([^/]+)\/(plugin|mcp)\.schema\.json$/;

/** A recognizable identifier for an unsupported Agent Plugins version, so the fault names the version instead of "invalid". */
export function declaredSchemaVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SCHEMA_ID_RE.exec(value)?.[1] ?? null;
}

const COMMAND_TOKEN_RE = /^(\.\/[^\s]+|[^\s/\\]+)$/;

export const pluginStdioServerSchema = z.strictObject({
  type: z.literal("stdio"),
  command: z.string().regex(COMMAND_TOKEN_RE, "command must be a bare executable name or a ./-relative path"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const httpUrlSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "url must be an absolute http(s) URL" },
);

export const pluginStreamableHttpServerSchema = z.strictObject({
  type: z.literal("streamable-http"),
  url: httpUrlSchema,
  headers: z.record(z.string(), z.string()).optional(),
});

export const pluginSseServerSchema = z.strictObject({
  type: z.literal("sse"),
  url: httpUrlSchema,
  headers: z.record(z.string(), z.string()).optional(),
});

const RESERVED_ENV_NAMES = [PLUGIN_ROOT_VAR, PLUGIN_DATA_VAR];

export const PLUGIN_ROOT_PLACEHOLDER = `\${${PLUGIN_ROOT_VAR}}`;
export const PLUGIN_DATA_PLACEHOLDER = `\${${PLUGIN_DATA_VAR}}`;

export const pluginMcpServerSchema = z
  .discriminatedUnion("type", [pluginStdioServerSchema, pluginStreamableHttpServerSchema, pluginSseServerSchema])
  .refine((server) => server.type !== "stdio" || !RESERVED_ENV_NAMES.some((name) => server.env && name in server.env), {
    message: `env must not contain ${RESERVED_ENV_NAMES.join(" or ")}`,
  })
  .refine((server) => server.type !== "stdio" || server.cwd === undefined || isValidCwdForm(server.cwd), {
    message: `cwd must be ./-relative or start with ${PLUGIN_ROOT_PLACEHOLDER} or ${PLUGIN_DATA_PLACEHOLDER}`,
  });
export type PluginMcpServer = z.infer<typeof pluginMcpServerSchema>;

/** Entries stay unparsed here: one invalid server must not invalidate the file, so each is validated on its own. */
export const pluginMcpFileSchema = z.strictObject({
  $schema: z.literal(PLUGIN_MCP_SCHEMA_ID),
  mcpServers: z.record(z.string(), z.unknown()),
});
export type PluginMcpFile = z.infer<typeof pluginMcpFileSchema>;

function isValidCwdForm(cwd: string): boolean {
  if (cwd.startsWith("./")) return true;
  for (const placeholder of [PLUGIN_ROOT_PLACEHOLDER, PLUGIN_DATA_PLACEHOLDER]) {
    if (cwd === placeholder || cwd.startsWith(`${placeholder}/`)) return true;
  }
  return false;
}

const PLUGIN_VAR_RE = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g;

export type PluginPaths = {
  root: string;
  dataDir: string;
};

/** One non-recursive pass, so text a replacement introduces is never scanned for further placeholders. */
export function expandPluginVars(value: string, paths: PluginPaths): string {
  return value.replace(PLUGIN_VAR_RE, (_match, name) => (name === PLUGIN_ROOT_VAR ? paths.root : paths.dataDir));
}

export function isContainedPath(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export const pluginFaultKindSchema = z.enum([
  "manifest-unreadable",
  "manifest-invalid",
  "manifest-version-unsupported",
  "manifest-name-mismatch",
  "duplicate-name",
  "mcp-unreadable",
  "mcp-invalid",
  "mcp-version-unsupported",
  "server-invalid",
  "server-unsupported-transport",
  "server-path-escape",
]);
export type PluginFaultKind = z.infer<typeof pluginFaultKindSchema>;

export type PluginServerNormalization =
  | { ok: true; server: McpServerConfig }
  | {
      ok: false;
      kind: Extract<PluginFaultKind, "server-invalid" | "server-unsupported-transport" | "server-path-escape">;
    };

/** Resolves a path through the filesystem; containment is meaningless against a path whose symlinks are unresolved. */
export type PluginPathResolver = (path: string) => string;

function containmentBase(rawPath: string, paths: PluginPaths): string {
  return rawPath.startsWith(PLUGIN_DATA_PLACEHOLDER) ? paths.dataDir : paths.root;
}

function resolveStdioCwd(
  raw: string | undefined,
  paths: PluginPaths,
  realpath: PluginPathResolver,
): string | { escape: true } {
  if (raw === undefined) return paths.root;
  const base = realpath(containmentBase(raw, paths));
  const resolved = realpath(resolve(paths.root, expandPluginVars(raw, paths)));
  if (!isContainedPath(base, resolved)) return { escape: true };
  return resolved;
}

function resolveStdioCommand(
  command: string,
  paths: PluginPaths,
  realpath: PluginPathResolver,
): string | { escape: true } {
  if (!command.startsWith("./")) return command;
  const resolved = realpath(resolve(paths.root, command));
  if (!isContainedPath(realpath(paths.root), resolved)) return { escape: true };
  return resolved;
}

/**
 * Turns a plugin's `mcp.json` entry into Acolyte's canonical server config: placeholders expanded,
 * paths resolved and contained, and `PLUGIN_ROOT`/`PLUGIN_DATA` baked into the environment so the
 * MCP client stays unaware that plugins exist.
 */
export function normalizePluginMcpServer(
  entry: unknown,
  paths: PluginPaths,
  realpath: PluginPathResolver,
): PluginServerNormalization {
  const parsed = pluginMcpServerSchema.safeParse(entry);
  if (!parsed.success) return { ok: false, kind: "server-invalid" };
  const server = parsed.data;

  if (server.type === "sse") return { ok: false, kind: "server-unsupported-transport" };

  if (server.type === "streamable-http") {
    return {
      ok: true,
      server: { type: "http", url: server.url, ...(server.headers ? { headers: server.headers } : {}) },
    };
  }

  const command = resolveStdioCommand(server.command, paths, realpath);
  if (typeof command !== "string") return { ok: false, kind: "server-path-escape" };

  const cwd = resolveStdioCwd(server.cwd, paths, realpath);
  if (typeof cwd !== "string") return { ok: false, kind: "server-path-escape" };

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(server.env ?? {})) {
    env[key] = expandPluginVars(value, paths);
  }
  env[PLUGIN_ROOT_VAR] = paths.root;
  env[PLUGIN_DATA_VAR] = paths.dataDir;

  return {
    ok: true,
    server: {
      type: "stdio",
      command,
      ...(server.args ? { args: server.args.map((arg) => expandPluginVars(arg, paths)) } : {}),
      env,
      cwd,
    },
  };
}

export const pluginScopeSchema = z.enum(["project", "user"]);
export type PluginScope = z.infer<typeof pluginScopeSchema>;

export const pluginMetaSchema = z.object({
  name: pluginNameSchema,
  scope: pluginScopeSchema,
  root: z.string().min(1),
  dataDir: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  skills: z.array(skillMetaSchema),
  mcpServers: z.record(z.string(), mcpServerSchema),
});
export type PluginMeta = z.infer<typeof pluginMetaSchema>;

export const pluginLoadDiagnosticsSchema = z.object({
  scannedDirs: z.number().int().nonnegative(),
  loaded: z.number().int().nonnegative(),
  missingManifests: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  unknownFields: z.number().int().nonnegative(),
  mcpDisabled: z.number().int().nonnegative(),
  skippedServers: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  skillsInvalid: z.number().int().nonnegative(),
  skillsDuplicates: z.number().int().nonnegative(),
  servers: z.number().int().nonnegative(),
  scannedAt: z.string().nullable(),
});
export type PluginLoadDiagnostics = z.infer<typeof pluginLoadDiagnosticsSchema>;

export function createEmptyPluginLoadDiagnostics(): PluginLoadDiagnostics {
  return {
    scannedDirs: 0,
    loaded: 0,
    missingManifests: 0,
    rejected: 0,
    duplicates: 0,
    unknownFields: 0,
    mcpDisabled: 0,
    skippedServers: 0,
    skills: 0,
    skillsInvalid: 0,
    skillsDuplicates: 0,
    servers: 0,
    scannedAt: null,
  };
}

/** Plugin server names share the MCP tool-id namespace with workspace servers, so the plugin name keeps them distinct. */
export function qualifyPluginServerName(pluginName: string, serverName: string): string {
  return `${pluginName}-${serverName}`;
}
