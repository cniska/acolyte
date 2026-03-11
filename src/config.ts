import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentModeSchema } from "./agent-contract";
import {
  CONFIG_SET_SCHEMAS,
  type Config,
  type ConfigScope,
  isModeModelKey,
  type LogFormat,
  type ResolvedConfig,
  toConfig,
} from "./config-contract";
import { t } from "./i18n";

const DEFAULT_CONFIG = {
  port: 6767,
  locale: "en" as const,
  model: "gpt-5-mini",
  openaiBaseUrl: "https://api.openai.com/v1",
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  googleBaseUrl: "https://generativelanguage.googleapis.com",
  logFormat: "logfmt" as LogFormat,
  transportMode: "rpc" as const,
  distillMessageThreshold: 20,
  distillReflectionThresholdTokens: 8_000,
  distillMaxOutputTokens: 1_000,
  memoryBudgetTokens: 1_200,
  memorySources: ["stored", "distill_project", "distill_user", "distill_session"] as const,
  contextMaxTokens: 8_000,
  maxHistoryMessages: 40,
  maxMessageTokens: 600,
  maxAttachmentMessageTokens: 3_000,
  maxPinnedMessageTokens: 1_200,
  replyTimeoutMs: 180_000,
};

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
  const userDataDir = join(options?.homeDir ?? homedir(), ".acolyte");
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

function readConfigScopeSync(scope: ConfigScope, options?: ConfigOptions): Config {
  const paths = resolvePaths(options);
  const raw =
    scope === "project"
      ? readSourceRecordSync(paths.projectTomlPath, paths.projectJsonPath)
      : readSourceRecordSync(paths.userTomlPath, paths.userJsonPath);
  return toConfig(raw);
}

async function readConfigScope(scope: ConfigScope, options?: ConfigOptions): Promise<Config> {
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
  if (config.models) {
    for (const [mode, m] of Object.entries(config.models)) {
      lines.push(`models.${mode} = ${JSON.stringify(m)}`);
    }
  }
  if (config.temperatures) {
    for (const [mode, value] of Object.entries(config.temperatures)) {
      lines.push(`temperatures.${mode} = ${value}`);
    }
  }
  if (config.distillModel) lines.push(`distillModel = ${JSON.stringify(config.distillModel)}`);
  if (typeof config.distillMessageThreshold === "number")
    lines.push(`distillMessageThreshold = ${config.distillMessageThreshold}`);
  if (typeof config.distillReflectionThresholdTokens === "number")
    lines.push(`distillReflectionThresholdTokens = ${config.distillReflectionThresholdTokens}`);
  if (typeof config.distillMaxOutputTokens === "number")
    lines.push(`distillMaxOutputTokens = ${config.distillMaxOutputTokens}`);
  if (typeof config.memoryBudgetTokens === "number") lines.push(`memoryBudgetTokens = ${config.memoryBudgetTokens}`);
  if (config.memorySources)
    lines.push(`memorySources = [${config.memorySources.map((value) => JSON.stringify(value)).join(", ")}]`);
  if (config.openaiBaseUrl) lines.push(`openaiBaseUrl = ${JSON.stringify(config.openaiBaseUrl)}`);
  if (config.anthropicBaseUrl) lines.push(`anthropicBaseUrl = ${JSON.stringify(config.anthropicBaseUrl)}`);
  if (config.googleBaseUrl) lines.push(`googleBaseUrl = ${JSON.stringify(config.googleBaseUrl)}`);
  if (config.logFormat) lines.push(`logFormat = ${JSON.stringify(config.logFormat)}`);
  if (config.transportMode) lines.push(`transportMode = ${JSON.stringify(config.transportMode)}`);
  if (typeof config.contextMaxTokens === "number") lines.push(`contextMaxTokens = ${config.contextMaxTokens}`);
  if (typeof config.maxHistoryMessages === "number") lines.push(`maxHistoryMessages = ${config.maxHistoryMessages}`);
  if (typeof config.maxMessageTokens === "number") lines.push(`maxMessageTokens = ${config.maxMessageTokens}`);
  if (typeof config.maxAttachmentMessageTokens === "number")
    lines.push(`maxAttachmentMessageTokens = ${config.maxAttachmentMessageTokens}`);
  if (typeof config.maxPinnedMessageTokens === "number")
    lines.push(`maxPinnedMessageTokens = ${config.maxPinnedMessageTokens}`);
  if (typeof config.replyTimeoutMs === "number") lines.push(`replyTimeoutMs = ${config.replyTimeoutMs}`);
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function resolveConfig(config: Config): ResolvedConfig {
  const model = config.model ?? DEFAULT_CONFIG.model;
  const port = config.port ?? DEFAULT_CONFIG.port;
  return {
    port,
    locale: config.locale ?? DEFAULT_CONFIG.locale,
    model,
    models: config.models ?? {},
    temperatures: config.temperatures ?? {},
    distillModel: config.distillModel ?? model,
    distillMessageThreshold: config.distillMessageThreshold ?? DEFAULT_CONFIG.distillMessageThreshold,
    distillReflectionThresholdTokens:
      config.distillReflectionThresholdTokens ?? DEFAULT_CONFIG.distillReflectionThresholdTokens,
    distillMaxOutputTokens: config.distillMaxOutputTokens ?? DEFAULT_CONFIG.distillMaxOutputTokens,
    memoryBudgetTokens: config.memoryBudgetTokens ?? DEFAULT_CONFIG.memoryBudgetTokens,
    memorySources: config.memorySources ?? [...DEFAULT_CONFIG.memorySources],
    openaiBaseUrl: config.openaiBaseUrl ?? DEFAULT_CONFIG.openaiBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl ?? DEFAULT_CONFIG.anthropicBaseUrl,
    googleBaseUrl: config.googleBaseUrl ?? DEFAULT_CONFIG.googleBaseUrl,
    logFormat: config.logFormat ?? DEFAULT_CONFIG.logFormat,
    transportMode: config.transportMode ?? DEFAULT_CONFIG.transportMode,
    contextMaxTokens: config.contextMaxTokens ?? DEFAULT_CONFIG.contextMaxTokens,
    maxHistoryMessages: config.maxHistoryMessages ?? DEFAULT_CONFIG.maxHistoryMessages,
    maxMessageTokens: config.maxMessageTokens ?? DEFAULT_CONFIG.maxMessageTokens,
    maxAttachmentMessageTokens: config.maxAttachmentMessageTokens ?? DEFAULT_CONFIG.maxAttachmentMessageTokens,
    maxPinnedMessageTokens: config.maxPinnedMessageTokens ?? DEFAULT_CONFIG.maxPinnedMessageTokens,
    replyTimeoutMs: config.replyTimeoutMs ?? DEFAULT_CONFIG.replyTimeoutMs,
  };
}

export function readResolvedConfigSync(options?: ConfigOptions): ResolvedConfig {
  return resolveConfig(readConfigSync(options));
}

export async function readConfig(options?: ConfigOptions): Promise<Config> {
  try {
    const userConfig = await readConfigScope("user", options);
    const projectConfig = await readConfigScope("project", options);
    return mergeConfigScopes(userConfig, projectConfig);
  } catch {
    return {};
  }
}

export function readConfigSync(options?: ConfigOptions): Config {
  try {
    const userConfig = readConfigScopeSync("user", options);
    const projectConfig = readConfigScopeSync("project", options);
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
  models: new Set([...agentModeSchema.options]),
  temperatures: new Set([...agentModeSchema.options]),
};

function parseDottedKey(key: string): { section: keyof Config; subKey: string } | null {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  const section = key.slice(0, dot) as keyof Config;
  const subKey = key.slice(dot + 1);
  if (!(section in CONFIG_SET_SCHEMAS) || subKey.length === 0) return null;
  if (section === "models" && !isModeModelKey(subKey)) return null;
  const allowed = RECORD_VALID_KEYS[section];
  if (allowed && !allowed.has(subKey)) return null;
  return { section, subKey };
}

export async function setConfigValue(key: string, value: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const dotted = parseDottedKey(key);
  if (dotted) {
    const schema = CONFIG_SET_SCHEMAS[dotted.section];
    const current = await readConfigScope(scope, options);
    const existing = (current[dotted.section] ?? {}) as Record<string, unknown>;
    const merged = { ...existing, [dotted.subKey]: value };
    const parsed = schema.safeParse(merged);
    if (!parsed.success)
      throw new Error(t("cli.config.invalid_value", { key, reason: parsed.error.issues[0]?.message ?? parsed.error.message }));
    const next: Config = { ...current, [dotted.section]: parsed.data };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof Config;
  if (!(topKey in CONFIG_SET_SCHEMAS)) throw new Error(t("cli.config.unknown_key", { key }));
  const parsed = CONFIG_SET_SCHEMAS[topKey].safeParse(value);
  if (!parsed.success)
    throw new Error(t("cli.config.invalid_value", { key, reason: parsed.error.issues[0]?.message ?? parsed.error.message }));
  const current = await readConfigScope(scope, options);
  const next: Config = { ...current, [topKey]: parsed.data };
  await writeConfig(next, { ...options, scope });
}

export async function unsetConfigValue(key: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const dotted = parseDottedKey(key);
  if (dotted) {
    const current = await readConfigScope(scope, options);
    const existing = (current[dotted.section] ?? {}) as Record<string, unknown>;
    const { [dotted.subKey]: _, ...rest } = existing;
    const next: Config = { ...current, [dotted.section]: Object.keys(rest).length > 0 ? rest : undefined };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof Config;
  const current = await readConfigScope(scope, options);
  const next: Config = { ...current };
  delete next[topKey];
  await writeConfig(next, { ...options, scope });
}

export async function readConfigForScope(scope: ConfigScope, options?: Omit<ConfigOptions, "scope">): Promise<Config> {
  return readConfigScope(scope, options);
}
