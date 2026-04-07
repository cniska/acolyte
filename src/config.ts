import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_SET_SCHEMAS,
  type Config,
  type ConfigScope,
  type LogFormat,
  type ResolvedConfig,
  toConfig,
} from "./config-contract";
import { featureFlagsSchema, resolvedFeatureFlagsSchema } from "./feature-flags-contract";
import { resolveHomeDir } from "./home-dir";
import { t } from "./i18n";

function createDefaultConfig() {
  return {
    port: 6767,
    locale: "en" as const,
    model: "gpt-5-mini",
    openaiBaseUrl: "https://api.openai.com/v1",
    anthropicBaseUrl: "https://api.anthropic.com/v1",
    googleBaseUrl: "https://generativelanguage.googleapis.com",
    vercelBaseUrl: "https://ai-gateway.vercel.sh/v1",
    logFormat: "logfmt" as LogFormat,
    replyTimeoutMs: 180_000,
    embeddingModel: "text-embedding-3-small",
    features: {},
  };
}

export type ConfigOptions = {
  homeDir?: string;
  cwd?: string;
  scope?: ConfigScope;
};

function mergeConfigScopes(base: Config, override: Config): Config {
  const merged: Config = { ...base };
  for (const [key, value] of Object.entries(override) as Array<[keyof Config, unknown]>) {
    if (value !== undefined) merged[key] = value as never;
  }
  return merged;
}

function resolvePaths(options?: ConfigOptions): {
  userDataDir: string;
  userJsonPath: string;
  userTomlPath: string;
  projectDataDir: string;
  projectJsonPath: string;
  projectTomlPath: string;
} {
  const userDataDir = join(options?.homeDir ?? resolveHomeDir(), ".acolyte");
  const projectDataDir = join(options?.cwd ?? process.cwd(), ".acolyte");
  return {
    userDataDir,
    userJsonPath: join(userDataDir, "config.json"),
    userTomlPath: join(userDataDir, "config.toml"),
    projectDataDir,
    projectJsonPath: join(projectDataDir, "config.json"),
    projectTomlPath: join(projectDataDir, "config.toml"),
  };
}

function readSourceRecordSync(tomlPath: string, jsonPath: string): Record<string, unknown> {
  if (existsSync(tomlPath)) {
    const rawToml = readFileSync(tomlPath, "utf8");
    return Bun.TOML.parse(rawToml) as Record<string, unknown>;
  }
  if (existsSync(jsonPath)) {
    const rawJson = readFileSync(jsonPath, "utf8");
    return JSON.parse(rawJson) as Record<string, unknown>;
  }
  return {};
}

async function readSourceRecord(tomlPath: string, jsonPath: string): Promise<Record<string, unknown>> {
  if (existsSync(tomlPath)) {
    const rawToml = await readFile(tomlPath, "utf8");
    return Bun.TOML.parse(rawToml) as Record<string, unknown>;
  }
  if (existsSync(jsonPath)) {
    const rawJson = await readFile(jsonPath, "utf8");
    return JSON.parse(rawJson) as Record<string, unknown>;
  }
  return {};
}

function readConfigForScopeSync(scope: ConfigScope, options?: ConfigOptions): Config {
  const paths = resolvePaths(options);
  const raw =
    scope === "project"
      ? readSourceRecordSync(paths.projectTomlPath, paths.projectJsonPath)
      : readSourceRecordSync(paths.userTomlPath, paths.userJsonPath);
  return toConfig(raw);
}

export async function readConfigForScope(scope: ConfigScope, options?: ConfigOptions): Promise<Config> {
  const paths = resolvePaths(options);
  const raw =
    scope === "project"
      ? await readSourceRecord(paths.projectTomlPath, paths.projectJsonPath)
      : await readSourceRecord(paths.userTomlPath, paths.userJsonPath);
  return toConfig(raw);
}

function serializeToml(config: Config): string {
  const lines: string[] = [];
  if (typeof config.port === "number") lines.push(`port = ${config.port}`);
  if (config.locale) lines.push(`locale = ${JSON.stringify(config.locale)}`);
  if (config.model) lines.push(`model = ${JSON.stringify(config.model)}`);
  if (typeof config.temperature === "number") lines.push(`temperature = ${config.temperature}`);
  if (config.distillModel) lines.push(`distillModel = ${JSON.stringify(config.distillModel)}`);
  if (config.openaiBaseUrl) lines.push(`openaiBaseUrl = ${JSON.stringify(config.openaiBaseUrl)}`);
  if (config.anthropicBaseUrl) lines.push(`anthropicBaseUrl = ${JSON.stringify(config.anthropicBaseUrl)}`);
  if (config.googleBaseUrl) lines.push(`googleBaseUrl = ${JSON.stringify(config.googleBaseUrl)}`);
  if (config.vercelBaseUrl) lines.push(`vercelBaseUrl = ${JSON.stringify(config.vercelBaseUrl)}`);
  if (config.logFormat) lines.push(`logFormat = ${JSON.stringify(config.logFormat)}`);
  if (typeof config.replyTimeoutMs === "number") lines.push(`replyTimeoutMs = ${config.replyTimeoutMs}`);
  if (config.reasoning) lines.push(`reasoning = ${JSON.stringify(config.reasoning)}`);
  if (config.embeddingModel) lines.push(`embeddingModel = ${JSON.stringify(config.embeddingModel)}`);
  if (config.cloudUrl) lines.push(`cloudUrl = ${JSON.stringify(config.cloudUrl)}`);
  if (config.cloudToken) lines.push(`cloudToken = ${JSON.stringify(config.cloudToken)}`);
  if (config.features && Object.keys(config.features).length > 0) {
    lines.push("");
    lines.push("[features]");
    if (typeof config.features.syncAgents === "boolean") lines.push(`syncAgents = ${config.features.syncAgents}`);
    if (typeof config.features.undoCheckpoints === "boolean")
      lines.push(`undoCheckpoints = ${config.features.undoCheckpoints}`);
    if (typeof config.features.parallelWorkspaces === "boolean")
      lines.push(`parallelWorkspaces = ${config.features.parallelWorkspaces}`);
    if (typeof config.features.cloudSync === "boolean") lines.push(`cloudSync = ${config.features.cloudSync}`);
  }
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function resolveConfig(config: Config): ResolvedConfig {
  const defaults = createDefaultConfig();
  const model = config.model ?? defaults.model;
  const port = config.port ?? defaults.port;
  const parsedFeatures = featureFlagsSchema.safeParse(config.features ?? {});
  const features = parsedFeatures.success ? parsedFeatures.data : {};
  const resolvedFeatures = resolvedFeatureFlagsSchema.parse(features);
  return {
    port,
    locale: config.locale ?? defaults.locale,
    model,
    temperature: config.temperature,
    distillModel: config.distillModel ?? model,
    openaiBaseUrl: config.openaiBaseUrl ?? defaults.openaiBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl ?? defaults.anthropicBaseUrl,
    googleBaseUrl: config.googleBaseUrl ?? defaults.googleBaseUrl,
    vercelBaseUrl: config.vercelBaseUrl ?? defaults.vercelBaseUrl,
    logFormat: config.logFormat ?? defaults.logFormat,
    replyTimeoutMs: config.replyTimeoutMs ?? defaults.replyTimeoutMs,
    reasoning: config.reasoning,
    embeddingModel: config.embeddingModel ?? defaults.embeddingModel,
    cloudUrl: config.cloudUrl,
    cloudToken: config.cloudToken,
    features: resolvedFeatures,
  };
}

export function readResolvedConfigSync(options?: ConfigOptions): ResolvedConfig {
  return resolveConfig(readConfigSync(options));
}

export async function readConfig(options?: ConfigOptions): Promise<Config> {
  try {
    const userConfig = await readConfigForScope("user", options);
    const projectConfig = await readConfigForScope("project", options);
    return mergeConfigScopes(userConfig, projectConfig);
  } catch {
    return {};
  }
}

export function readConfigSync(options?: ConfigOptions): Config {
  try {
    const userConfig = readConfigForScopeSync("user", options);
    const projectConfig = readConfigForScopeSync("project", options);
    return mergeConfigScopes(userConfig, projectConfig);
  } catch {
    return {};
  }
}

export async function writeConfig(config: Config, options?: ConfigOptions): Promise<void> {
  const paths = resolvePaths(options);
  const sanitized = toConfig(config as Record<string, unknown>);
  const scope = options?.scope ?? "user";
  const dataDir = scope === "project" ? paths.projectDataDir : paths.userDataDir;
  const tomlPath = scope === "project" ? paths.projectTomlPath : paths.userTomlPath;
  await mkdir(dataDir, { recursive: true });
  await writeFile(tomlPath, serializeToml(sanitized), "utf8");
}

const RECORD_VALID_KEYS: Partial<Record<keyof Config, Set<string>>> = {
  features: new Set(["syncAgents", "undoCheckpoints", "parallelWorkspaces", "cloudSync"]),
};

function parseDottedKey(key: string): { section: keyof Config; subKey: string } | null {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  const section = key.slice(0, dot) as keyof Config;
  const subKey = key.slice(dot + 1);
  if (!(section in CONFIG_SET_SCHEMAS) || subKey.length === 0) return null;
  const allowed = RECORD_VALID_KEYS[section];
  if (!allowed || !allowed.has(subKey)) return null;
  return { section, subKey };
}

const CONFIG_VALIDATORS: Partial<Record<keyof Config, (value: string) => string | null>> = {};

export async function setConfigValue(key: string, value: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const dotted = parseDottedKey(key);
  if (dotted) {
    const schema = CONFIG_SET_SCHEMAS[dotted.section];
    if (!schema) throw new Error(t("cli.config.unknown_key", { key }));
    const current = await readConfigForScope(scope, options);
    const existing = (current[dotted.section] ?? {}) as Record<string, unknown>;
    const merged = { ...existing, [dotted.subKey]: value };
    const parsed = schema.safeParse(merged);
    if (!parsed.success)
      throw new Error(
        t("cli.config.invalid_value", { key, reason: parsed.error.issues[0]?.message ?? parsed.error.message }),
      );
    const next: Config = { ...current, [dotted.section]: parsed.data };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof Config;
  const topSchema = CONFIG_SET_SCHEMAS[topKey];
  if (!topSchema) throw new Error(t("cli.config.unknown_key", { key }));
  const parsed = topSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      t("cli.config.invalid_value", { key, reason: parsed.error.issues[0]?.message ?? parsed.error.message }),
    );
  const validationError = CONFIG_VALIDATORS[topKey]?.(value);
  if (validationError) throw new Error(validationError);
  const current = await readConfigForScope(scope, options);
  const next: Config = { ...current, [topKey]: parsed.data };
  await writeConfig(next, { ...options, scope });
}

export async function unsetConfigValue(key: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const dotted = parseDottedKey(key);
  if (dotted) {
    const current = await readConfigForScope(scope, options);
    const existing = (current[dotted.section] ?? {}) as Record<string, unknown>;
    const { [dotted.subKey]: _, ...rest } = existing;
    const next: Config = { ...current, [dotted.section]: Object.keys(rest).length > 0 ? rest : undefined };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof Config;
  const current = await readConfigForScope(scope, options);
  const next: Config = { ...current };
  delete next[topKey];
  await writeConfig(next, { ...options, scope });
}
