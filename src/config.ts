import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export type ConfigPermissionMode = "read" | "write";
export type ConfigLogFormat = "logfmt" | "json";

const MAX_CONTEXT_TOKENS = 32_000;
const MAX_OM_OBSERVATION_TOKENS = 12_000;
const MAX_OM_REFLECTION_TOKENS = 32_000;
const MAX_MESSAGE_TOKENS = 4_000;
const MAX_ATTACHMENT_MESSAGE_TOKENS = 12_000;
const MAX_PINNED_MESSAGE_TOKENS = 4_000;
const MAX_RUN_REPLY_TIMEOUT_MS = 600_000;
const nonEmptyStringSchema = z.string().trim().min(1);
const parseIntegerSchema = (min: number, max: number): z.ZodType<number> =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
    z.number().int().min(min).max(max),
  );

const DEFAULT_CONFIG = {
  port: 6767,
  model: "gpt-5-mini",
  openaiBaseUrl: "https://api.openai.com/v1",
  anthropicBaseUrl: "https://api.anthropic.com",
  permissionMode: "read" as ConfigPermissionMode,
  logFormat: "logfmt" as ConfigLogFormat,
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
  omModel?: string;
  apiUrl?: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  googleBaseUrl?: string;
  permissionMode?: ConfigPermissionMode;
  logFormat?: ConfigLogFormat;
  omObservationTokens?: number;
  omReflectionTokens?: number;
  contextMaxTokens?: number;
  maxHistoryMessages?: number;
  maxMessageTokens?: number;
  maxAttachmentMessageTokens?: number;
  maxPinnedMessageTokens?: number;
  replyTimeoutMs?: number;
}

export interface ResolvedAcolyteConfig {
  port: number;
  model: string;
  models: Record<string, string>;
  omModel: string;
  apiUrl?: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  googleBaseUrl?: string;
  permissionMode: ConfigPermissionMode;
  logFormat: ConfigLogFormat;
  omObservationTokens: number;
  omReflectionTokens: number;
  contextMaxTokens: number;
  maxHistoryMessages: number;
  maxMessageTokens: number;
  maxAttachmentMessageTokens: number;
  maxPinnedMessageTokens: number;
  replyTimeoutMs: number;
}

export type ConfigScope = "user" | "project";

type ConfigOptions = {
  homeDir?: string;
  cwd?: string;
  scope?: ConfigScope;
};

const CONFIG_SET_SCHEMAS: Record<keyof AcolyteConfig, z.ZodTypeAny> = {
  port: parseIntegerSchema(1, 65535),
  model: nonEmptyStringSchema,
  models: z.record(z.string(), nonEmptyStringSchema),
  omModel: nonEmptyStringSchema,
  apiUrl: nonEmptyStringSchema,
  openaiBaseUrl: nonEmptyStringSchema,
  anthropicBaseUrl: nonEmptyStringSchema,
  googleBaseUrl: nonEmptyStringSchema,
  permissionMode: z.enum(["read", "write"]),
  logFormat: z.enum(["logfmt", "json"]),
  omObservationTokens: parseIntegerSchema(500, MAX_OM_OBSERVATION_TOKENS),
  omReflectionTokens: parseIntegerSchema(1000, MAX_OM_REFLECTION_TOKENS),
  contextMaxTokens: parseIntegerSchema(1000, MAX_CONTEXT_TOKENS),
  maxHistoryMessages: parseIntegerSchema(1, 200),
  maxMessageTokens: parseIntegerSchema(50, MAX_MESSAGE_TOKENS),
  maxAttachmentMessageTokens: parseIntegerSchema(100, MAX_ATTACHMENT_MESSAGE_TOKENS),
  maxPinnedMessageTokens: parseIntegerSchema(100, MAX_PINNED_MESSAGE_TOKENS),
  replyTimeoutMs: parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS),
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
              const result = nonEmptyStringSchema.safeParse(v);
              return result.success ? [[k, result.data]] : [];
            }),
          )
        : undefined,
    omModel: parseField(nonEmptyStringSchema, input.omModel),
    apiUrl: parseField(nonEmptyStringSchema, input.apiUrl),
    openaiBaseUrl: parseField(nonEmptyStringSchema, input.openaiBaseUrl),
    anthropicBaseUrl: parseField(nonEmptyStringSchema, input.anthropicBaseUrl),
    googleBaseUrl: parseField(nonEmptyStringSchema, input.googleBaseUrl),
    permissionMode: parseField(z.enum(["read", "write"]), input.permissionMode),
    logFormat: parseField(z.enum(["logfmt", "json"]), input.logFormat),
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
  };
}

function mergeConfigScopes(base: AcolyteConfig, override: AcolyteConfig): AcolyteConfig {
  const merged: AcolyteConfig = { ...base };
  for (const [key, value] of Object.entries(override) as Array<[keyof AcolyteConfig, unknown]>) {
    if (value !== undefined) {
      merged[key] = value as never;
    }
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
  if (typeof config.port === "number") {
    lines.push(`port = ${config.port}`);
  }
  if (config.model) {
    lines.push(`model = ${JSON.stringify(config.model)}`);
  }
  if (config.models) {
    for (const [mode, m] of Object.entries(config.models)) {
      lines.push(`models.${mode} = ${JSON.stringify(m)}`);
    }
  }
  if (config.omModel) {
    lines.push(`omModel = ${JSON.stringify(config.omModel)}`);
  }
  if (config.apiUrl) {
    lines.push(`apiUrl = ${JSON.stringify(config.apiUrl)}`);
  }
  if (config.openaiBaseUrl) {
    lines.push(`openaiBaseUrl = ${JSON.stringify(config.openaiBaseUrl)}`);
  }
  if (config.anthropicBaseUrl) {
    lines.push(`anthropicBaseUrl = ${JSON.stringify(config.anthropicBaseUrl)}`);
  }
  if (config.googleBaseUrl) {
    lines.push(`googleBaseUrl = ${JSON.stringify(config.googleBaseUrl)}`);
  }
  if (config.permissionMode) {
    lines.push(`permissionMode = ${JSON.stringify(config.permissionMode)}`);
  }
  if (config.logFormat) {
    lines.push(`logFormat = ${JSON.stringify(config.logFormat)}`);
  }
  if (typeof config.omObservationTokens === "number") {
    lines.push(`omObservationTokens = ${config.omObservationTokens}`);
  }
  if (typeof config.omReflectionTokens === "number") {
    lines.push(`omReflectionTokens = ${config.omReflectionTokens}`);
  }
  if (typeof config.contextMaxTokens === "number") {
    lines.push(`contextMaxTokens = ${config.contextMaxTokens}`);
  }
  if (typeof config.maxHistoryMessages === "number") {
    lines.push(`maxHistoryMessages = ${config.maxHistoryMessages}`);
  }
  if (typeof config.maxMessageTokens === "number") {
    lines.push(`maxMessageTokens = ${config.maxMessageTokens}`);
  }
  if (typeof config.maxAttachmentMessageTokens === "number") {
    lines.push(`maxAttachmentMessageTokens = ${config.maxAttachmentMessageTokens}`);
  }
  if (typeof config.maxPinnedMessageTokens === "number") {
    lines.push(`maxPinnedMessageTokens = ${config.maxPinnedMessageTokens}`);
  }
  if (typeof config.replyTimeoutMs === "number") {
    lines.push(`replyTimeoutMs = ${config.replyTimeoutMs}`);
  }
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function resolveConfig(config: AcolyteConfig): ResolvedAcolyteConfig {
  const model = config.model ?? DEFAULT_CONFIG.model;
  return {
    port: config.port ?? DEFAULT_CONFIG.port,
    model,
    models: config.models ?? {},
    omModel: config.omModel ?? model,
    apiUrl: config.apiUrl,
    openaiBaseUrl: config.openaiBaseUrl ?? DEFAULT_CONFIG.openaiBaseUrl,
    anthropicBaseUrl: config.anthropicBaseUrl ?? DEFAULT_CONFIG.anthropicBaseUrl,
    googleBaseUrl: config.googleBaseUrl,
    permissionMode: config.permissionMode ?? DEFAULT_CONFIG.permissionMode,
    logFormat: config.logFormat ?? DEFAULT_CONFIG.logFormat,
    omObservationTokens: config.omObservationTokens ?? DEFAULT_CONFIG.omObservationTokens,
    omReflectionTokens: config.omReflectionTokens ?? DEFAULT_CONFIG.omReflectionTokens,
    contextMaxTokens: config.contextMaxTokens ?? DEFAULT_CONFIG.contextMaxTokens,
    maxHistoryMessages: config.maxHistoryMessages ?? DEFAULT_CONFIG.maxHistoryMessages,
    maxMessageTokens: config.maxMessageTokens ?? DEFAULT_CONFIG.maxMessageTokens,
    maxAttachmentMessageTokens: config.maxAttachmentMessageTokens ?? DEFAULT_CONFIG.maxAttachmentMessageTokens,
    maxPinnedMessageTokens: config.maxPinnedMessageTokens ?? DEFAULT_CONFIG.maxPinnedMessageTokens,
    replyTimeoutMs: config.replyTimeoutMs ?? DEFAULT_CONFIG.replyTimeoutMs,
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

export async function setConfigValue(key: keyof AcolyteConfig, value: string, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const parsed = CONFIG_SET_SCHEMAS[key].safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid value for ${key}`);
  }
  const current = await readConfigScope(scope, options);
  const next: AcolyteConfig = { ...current, [key]: parsed.data };
  await writeConfig(next, { ...options, scope });
}

export async function unsetConfigValue(key: keyof AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const scope = options?.scope ?? "user";
  const current = await readConfigScope(scope, options);
  const next: AcolyteConfig = { ...current };
  delete next[key];
  await writeConfig(next, { ...options, scope });
}

export async function readConfigForScope(
  scope: ConfigScope,
  options?: Omit<ConfigOptions, "scope">,
): Promise<AcolyteConfig> {
  return readConfigScope(scope, options);
}
