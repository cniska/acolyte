import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agentModes } from "./agent-modes";
import {
  type ConfigScope,
  type LogFormat,
  logFormatSchema,
  type PermissionMode,
  permissionModeSchema,
  type TransportMode,
  transportModeSchema,
} from "./config-modes";
import { guardIdSchema } from "./tool-guards";

const MAX_CONTEXT_TOKENS = 32_000;
const MAX_OM_OBSERVATION_TOKENS = 12_000;
const MAX_OM_REFLECTION_TOKENS = 32_000;
const MAX_MESSAGE_TOKENS = 4_000;
const MAX_ATTACHMENT_MESSAGE_TOKENS = 12_000;
const MAX_PINNED_MESSAGE_TOKENS = 4_000;
const MAX_RUN_REPLY_TIMEOUT_MS = 600_000;
const MAX_TEMPERATURE = 2;
const nonEmptyStringSchema = z.string().trim().min(1);
const parseIntegerSchema = (min: number, max: number): z.ZodType<number> =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
    z.number().int().min(min).max(max),
  );
const parseTemperatureSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
  z.number().min(0).max(MAX_TEMPERATURE),
);
const modeTemperatureMapSchema = z
  .record(
    z.string(),
    z.preprocess(
      (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
      z.number().min(0).max(MAX_TEMPERATURE),
    ),
  )
  .transform((input) => Object.fromEntries(Object.entries(input).filter(([mode]) => mode in agentModes)));

const DEFAULT_CONFIG = {
  port: 6767,
  model: "gpt-5-mini",
  openaiBaseUrl: "https://api.openai.com/v1",
  anthropicBaseUrl: "https://api.anthropic.com",
  permissionMode: "read" as PermissionMode,
  logFormat: "logfmt" as LogFormat,
  transportMode: "auto" as TransportMode,
  omObservationTokens: 3_000,
  omReflectionTokens: 8_000,
  contextMaxTokens: 8_000,
  maxHistoryMessages: 40,
  maxMessageTokens: 600,
  maxAttachmentMessageTokens: 3_000,
  maxPinnedMessageTokens: 1_200,
  replyTimeoutMs: 180_000,
};

export interface AcolyteConfig {
  port?: number;
  model?: string;
  models?: Record<string, string>;
  temperatures?: Record<string, number>;
  omModel?: string;
  apiUrl?: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  googleBaseUrl?: string;
  permissionMode?: PermissionMode;
  logFormat?: LogFormat;
  transportMode?: TransportMode;
  omObservationTokens?: number;
  omReflectionTokens?: number;
  contextMaxTokens?: number;
  maxHistoryMessages?: number;
  maxMessageTokens?: number;
  maxAttachmentMessageTokens?: number;
  maxPinnedMessageTokens?: number;
  replyTimeoutMs?: number;
  disabledGuards?: string[];
}

export interface ResolvedAcolyteConfig {
  port: number;
  model: string;
  models: Record<string, string>;
  temperatures: Record<string, number>;
  omModel: string;
  apiUrl?: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  googleBaseUrl?: string;
  permissionMode: PermissionMode;
  logFormat: LogFormat;
  transportMode: TransportMode;
  omObservationTokens: number;
  omReflectionTokens: number;
  contextMaxTokens: number;
  maxHistoryMessages: number;
  maxMessageTokens: number;
  maxAttachmentMessageTokens: number;
  maxPinnedMessageTokens: number;
  replyTimeoutMs: number;
  disabledGuards: string[];
}

type ConfigOptions = {
  homeDir?: string;
  cwd?: string;
  scope?: ConfigScope;
};

const CONFIG_SET_SCHEMAS: Record<keyof AcolyteConfig, z.ZodTypeAny> = {
  port: parseIntegerSchema(1, 65535),
  model: nonEmptyStringSchema,
  models: z.record(z.string(), nonEmptyStringSchema),
  temperatures: modeTemperatureMapSchema,
  omModel: nonEmptyStringSchema,
  apiUrl: nonEmptyStringSchema,
  openaiBaseUrl: nonEmptyStringSchema,
  anthropicBaseUrl: nonEmptyStringSchema,
  googleBaseUrl: nonEmptyStringSchema,
  permissionMode: permissionModeSchema,
  logFormat: logFormatSchema,
  transportMode: transportModeSchema,
  omObservationTokens: parseIntegerSchema(500, MAX_OM_OBSERVATION_TOKENS),
  omReflectionTokens: parseIntegerSchema(1000, MAX_OM_REFLECTION_TOKENS),
  contextMaxTokens: parseIntegerSchema(1000, MAX_CONTEXT_TOKENS),
  maxHistoryMessages: parseIntegerSchema(1, 200),
  maxMessageTokens: parseIntegerSchema(50, MAX_MESSAGE_TOKENS),
  maxAttachmentMessageTokens: parseIntegerSchema(100, MAX_ATTACHMENT_MESSAGE_TOKENS),
  maxPinnedMessageTokens: parseIntegerSchema(100, MAX_PINNED_MESSAGE_TOKENS),
  replyTimeoutMs: parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS),
  disabledGuards: z.array(guardIdSchema),
};

function toConfig(input: Record<string, unknown>): AcolyteConfig {
  const parseField = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  };

  return {
    port: parseField(parseIntegerSchema(1, 65535), input.port),
    model: parseField(nonEmptyStringSchema, input.model),
    models:
      typeof input.models === "object" && input.models !== null
        ? Object.fromEntries(
            Object.entries(input.models as Record<string, unknown>).flatMap(([k, v]) => {
              if (!(k in agentModes)) return [];
              const result = nonEmptyStringSchema.safeParse(v);
              return result.success ? [[k, result.data]] : [];
            }),
          )
        : undefined,
    temperatures:
      typeof input.temperatures === "object" && input.temperatures !== null
        ? Object.fromEntries(
            Object.entries(input.temperatures as Record<string, unknown>).flatMap(([k, v]) => {
              if (!(k in agentModes)) return [];
              const result = parseTemperatureSchema.safeParse(v);
              return result.success ? [[k, result.data]] : [];
            }),
          )
        : undefined,
    omModel: parseField(nonEmptyStringSchema, input.omModel),
    apiUrl: parseField(nonEmptyStringSchema, input.apiUrl),
    openaiBaseUrl: parseField(nonEmptyStringSchema, input.openaiBaseUrl),
    anthropicBaseUrl: parseField(nonEmptyStringSchema, input.anthropicBaseUrl),
    googleBaseUrl: parseField(nonEmptyStringSchema, input.googleBaseUrl),
    permissionMode: parseField(permissionModeSchema, input.permissionMode),
    logFormat: parseField(logFormatSchema, input.logFormat),
    transportMode: parseField(transportModeSchema, input.transportMode),
    omObservationTokens: parseField(parseIntegerSchema(500, MAX_OM_OBSERVATION_TOKENS), input.omObservationTokens),
    omReflectionTokens: parseField(parseIntegerSchema(1000, MAX_OM_REFLECTION_TOKENS), input.omReflectionTokens),
    contextMaxTokens: parseField(parseIntegerSchema(1000, MAX_CONTEXT_TOKENS), input.contextMaxTokens),
    maxHistoryMessages: parseField(parseIntegerSchema(1, 200), input.maxHistoryMessages),
    maxMessageTokens: parseField(parseIntegerSchema(50, MAX_MESSAGE_TOKENS), input.maxMessageTokens),
    maxAttachmentMessageTokens: parseField(
      parseIntegerSchema(100, MAX_ATTACHMENT_MESSAGE_TOKENS),
      input.maxAttachmentMessageTokens,
    ),
    maxPinnedMessageTokens: parseField(
      parseIntegerSchema(100, MAX_PINNED_MESSAGE_TOKENS),
      input.maxPinnedMessageTokens,
    ),
    replyTimeoutMs: parseField(parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS), input.replyTimeoutMs),
    disabledGuards: parseField(z.array(guardIdSchema), input.disabledGuards),
  };
}

function mergeConfigScopes(base: AcolyteConfig, override: AcolyteConfig): AcolyteConfig {
  const merged: AcolyteConfig = { ...base };
  for (const [key, value] of Object.entries(override) as Array<[keyof AcolyteConfig, unknown]>) {
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

function readConfigScopeSync(scope: ConfigScope, options?: ConfigOptions): AcolyteConfig {
  const paths = resolvePaths(options);
  const raw =
    scope === "project"
      ? readSourceRecordSync(paths.projectTomlPath, paths.projectJsonPath)
      : readSourceRecordSync(paths.userTomlPath, paths.userJsonPath);
  return toConfig(raw);
}

async function readConfigScope(scope: ConfigScope, options?: ConfigOptions): Promise<AcolyteConfig> {
  const paths = resolvePaths(options);
  const raw =
    scope === "project"
      ? await readSourceRecord(paths.projectTomlPath, paths.projectJsonPath)
      : await readSourceRecord(paths.userTomlPath, paths.userJsonPath);
  return toConfig(raw);
}

function serializeToml(config: AcolyteConfig): string {
  const lines: string[] = [];
  if (typeof config.port === "number") lines.push(`port = ${config.port}`);
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
  if (config.omModel) lines.push(`omModel = ${JSON.stringify(config.omModel)}`);
  if (config.apiUrl) lines.push(`apiUrl = ${JSON.stringify(config.apiUrl)}`);
  if (config.openaiBaseUrl) lines.push(`openaiBaseUrl = ${JSON.stringify(config.openaiBaseUrl)}`);
  if (config.anthropicBaseUrl) lines.push(`anthropicBaseUrl = ${JSON.stringify(config.anthropicBaseUrl)}`);
  if (config.googleBaseUrl) lines.push(`googleBaseUrl = ${JSON.stringify(config.googleBaseUrl)}`);
  if (config.permissionMode) lines.push(`permissionMode = ${JSON.stringify(config.permissionMode)}`);
  if (config.logFormat) lines.push(`logFormat = ${JSON.stringify(config.logFormat)}`);
  if (config.transportMode) lines.push(`transportMode = ${JSON.stringify(config.transportMode)}`);
  if (typeof config.omObservationTokens === "number") lines.push(`omObservationTokens = ${config.omObservationTokens}`);
  if (typeof config.omReflectionTokens === "number") lines.push(`omReflectionTokens = ${config.omReflectionTokens}`);
  if (typeof config.contextMaxTokens === "number") lines.push(`contextMaxTokens = ${config.contextMaxTokens}`);
  if (typeof config.maxHistoryMessages === "number") lines.push(`maxHistoryMessages = ${config.maxHistoryMessages}`);
  if (typeof config.maxMessageTokens === "number") lines.push(`maxMessageTokens = ${config.maxMessageTokens}`);
  if (typeof config.maxAttachmentMessageTokens === "number")
    lines.push(`maxAttachmentMessageTokens = ${config.maxAttachmentMessageTokens}`);
  if (typeof config.maxPinnedMessageTokens === "number")
    lines.push(`maxPinnedMessageTokens = ${config.maxPinnedMessageTokens}`);
  if (typeof config.replyTimeoutMs === "number") lines.push(`replyTimeoutMs = ${config.replyTimeoutMs}`);
  if (config.disabledGuards && config.disabledGuards.length > 0)
    lines.push(`disabledGuards = ${JSON.stringify(config.disabledGuards)}`);
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function resolveConfig(config: AcolyteConfig): ResolvedAcolyteConfig {
  const model = config.model ?? DEFAULT_CONFIG.model;
  return {
    port: config.port ?? DEFAULT_CONFIG.port,
    model,
    models: config.models ?? {},
    temperatures: config.temperatures ?? {},
    omModel: config.omModel ?? model,
    apiUrl: config.apiUrl,
    openaiBaseUrl: config.openaiBaseUrl ?? DEFAULT_CONFIG.openaiBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl ?? DEFAULT_CONFIG.anthropicBaseUrl,
    googleBaseUrl: config.googleBaseUrl,
    permissionMode: config.permissionMode ?? DEFAULT_CONFIG.permissionMode,
    logFormat: config.logFormat ?? DEFAULT_CONFIG.logFormat,
    transportMode: config.transportMode ?? DEFAULT_CONFIG.transportMode,
    omObservationTokens: config.omObservationTokens ?? DEFAULT_CONFIG.omObservationTokens,
    omReflectionTokens: config.omReflectionTokens ?? DEFAULT_CONFIG.omReflectionTokens,
    contextMaxTokens: config.contextMaxTokens ?? DEFAULT_CONFIG.contextMaxTokens,
    maxHistoryMessages: config.maxHistoryMessages ?? DEFAULT_CONFIG.maxHistoryMessages,
    maxMessageTokens: config.maxMessageTokens ?? DEFAULT_CONFIG.maxMessageTokens,
    maxAttachmentMessageTokens: config.maxAttachmentMessageTokens ?? DEFAULT_CONFIG.maxAttachmentMessageTokens,
    maxPinnedMessageTokens: config.maxPinnedMessageTokens ?? DEFAULT_CONFIG.maxPinnedMessageTokens,
    replyTimeoutMs: config.replyTimeoutMs ?? DEFAULT_CONFIG.replyTimeoutMs,
    disabledGuards: config.disabledGuards ?? [],
  };
}

export function readResolvedConfigSync(options?: ConfigOptions): ResolvedAcolyteConfig {
  return resolveConfig(readConfigSync(options));
}

export async function readConfig(options?: ConfigOptions): Promise<AcolyteConfig> {
  try {
    const userConfig = await readConfigScope("user", options);
    const projectConfig = await readConfigScope("project", options);
    return mergeConfigScopes(userConfig, projectConfig);
  } catch {
    return {};
  }
}

export function readConfigSync(options?: ConfigOptions): AcolyteConfig {
  try {
    const userConfig = readConfigScopeSync("user", options);
    const projectConfig = readConfigScopeSync("project", options);
    return mergeConfigScopes(userConfig, projectConfig);
  } catch {
    return {};
  }
}

export async function writeConfig(config: AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const paths = resolvePaths(options);
  const sanitized = toConfig(config as Record<string, unknown>);
  const scope = options?.scope ?? "user";
  const dataDir = scope === "project" ? paths.projectDataDir : paths.userDataDir;
  const tomlPath = scope === "project" ? paths.projectTomlPath : paths.userTomlPath;
  await mkdir(dataDir, { recursive: true });
  await writeFile(tomlPath, serializeToml(sanitized), "utf8");
}

const RECORD_VALID_KEYS: Partial<Record<keyof AcolyteConfig, Set<string>>> = {
  models: new Set(Object.keys(agentModes)),
  temperatures: new Set(Object.keys(agentModes)),
};

function parseDottedKey(key: string): { section: keyof AcolyteConfig; subKey: string } | null {
  const dot = key.indexOf(".");
  if (dot < 0) return null;
  const section = key.slice(0, dot) as keyof AcolyteConfig;
  const subKey = key.slice(dot + 1);
  if (!(section in CONFIG_SET_SCHEMAS) || subKey.length === 0) return null;
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
    if (!parsed.success) throw new Error(`Invalid value for ${key}`);
    const next: AcolyteConfig = { ...current, [dotted.section]: parsed.data };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof AcolyteConfig;
  if (!(topKey in CONFIG_SET_SCHEMAS)) throw new Error(`Unknown config key: ${key}`);
  const parsed = CONFIG_SET_SCHEMAS[topKey].safeParse(value);
  if (!parsed.success) throw new Error(`Invalid value for ${key}`);
  const current = await readConfigScope(scope, options);
  const next: AcolyteConfig = { ...current, [topKey]: parsed.data };
  await writeConfig(next, { ...options, scope });
}

export async function unsetConfigValue(key: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const dotted = parseDottedKey(key);
  if (dotted) {
    const current = await readConfigScope(scope, options);
    const existing = (current[dotted.section] ?? {}) as Record<string, string>;
    const { [dotted.subKey]: _, ...rest } = existing;
    const next: AcolyteConfig = { ...current, [dotted.section]: Object.keys(rest).length > 0 ? rest : undefined };
    await writeConfig(next, { ...options, scope });
    return;
  }
  const topKey = key as keyof AcolyteConfig;
  const current = await readConfigScope(scope, options);
  const next: AcolyteConfig = { ...current };
  delete next[topKey];
  await writeConfig(next, { ...options, scope });
}

export async function readConfigForScope(
  scope: ConfigScope,
  options?: Omit<ConfigOptions, "scope">,
): Promise<AcolyteConfig> {
  return readConfigScope(scope, options);
}
