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
};

export interface AcolyteConfig {
  port?: number;
  model?: string;
  modelPlanner?: string;
  modelCoder?: string;
  modelReviewer?: string;
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
}

export interface ResolvedAcolyteConfig {
  port: number;
  model: string;
  modelPlanner?: string;
  modelCoder?: string;
  modelReviewer?: string;
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
}

type ConfigOptions = {
  homeDir?: string;
  cwd?: string;
};

function toConfig(input: Record<string, unknown>): AcolyteConfig {
  const parseField = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  };
  const parseInteger = (min: number, max: number): z.ZodType<number> =>
    z.preprocess(
      (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
      z.number().int().min(min).max(max),
    );
  const nonEmptyString = z.string().trim().min(1);

  return {
    port: parseField(parseInteger(1, 65535), input.port),
    model: parseField(nonEmptyString, input.model),
    modelPlanner: parseField(nonEmptyString, input.modelPlanner),
    modelCoder: parseField(nonEmptyString, input.modelCoder),
    modelReviewer: parseField(nonEmptyString, input.modelReviewer),
    omModel: parseField(nonEmptyString, input.omModel),
    apiUrl: parseField(nonEmptyString, input.apiUrl),
    openaiBaseUrl: parseField(nonEmptyString, input.openaiBaseUrl),
    anthropicBaseUrl: parseField(nonEmptyString, input.anthropicBaseUrl),
    googleBaseUrl: parseField(nonEmptyString, input.googleBaseUrl),
    permissionMode: parseField(z.enum(["read", "write"]), input.permissionMode),
    logFormat: parseField(z.enum(["logfmt", "json"]), input.logFormat),
    omObservationTokens: parseField(parseInteger(500, MAX_OM_OBSERVATION_TOKENS), input.omObservationTokens),
    omReflectionTokens: parseField(parseInteger(1000, MAX_OM_REFLECTION_TOKENS), input.omReflectionTokens),
    contextMaxTokens: parseField(parseInteger(1000, MAX_CONTEXT_TOKENS), input.contextMaxTokens),
    maxHistoryMessages: parseField(parseInteger(1, 200), input.maxHistoryMessages),
    maxMessageTokens: parseField(parseInteger(50, MAX_MESSAGE_TOKENS), input.maxMessageTokens),
    maxAttachmentMessageTokens: parseField(
      parseInteger(100, MAX_ATTACHMENT_MESSAGE_TOKENS),
      input.maxAttachmentMessageTokens,
    ),
    maxPinnedMessageTokens: parseField(parseInteger(100, MAX_PINNED_MESSAGE_TOKENS), input.maxPinnedMessageTokens),
  };
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

function serializeToml(config: AcolyteConfig): string {
  const lines: string[] = [];
  if (typeof config.port === "number") {
    lines.push(`port = ${config.port}`);
  }
  if (config.model) {
    lines.push(`model = ${JSON.stringify(config.model)}`);
  }
  if (config.modelPlanner) {
    lines.push(`modelPlanner = ${JSON.stringify(config.modelPlanner)}`);
  }
  if (config.modelCoder) {
    lines.push(`modelCoder = ${JSON.stringify(config.modelCoder)}`);
  }
  if (config.modelReviewer) {
    lines.push(`modelReviewer = ${JSON.stringify(config.modelReviewer)}`);
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
  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

export function resolveConfig(config: AcolyteConfig): ResolvedAcolyteConfig {
  const model = config.model ?? DEFAULT_CONFIG.model;
  return {
    port: config.port ?? DEFAULT_CONFIG.port,
    model,
    modelPlanner: config.modelPlanner,
    modelCoder: config.modelCoder,
    modelReviewer: config.modelReviewer,
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
  };
}

export function readResolvedConfigSync(options?: ConfigOptions): ResolvedAcolyteConfig {
  return resolveConfig(readConfigSync(options));
}

export async function readConfig(options?: ConfigOptions): Promise<AcolyteConfig> {
  const paths = resolvePaths(options);
  const readSource = async (tomlPath: string, jsonPath: string): Promise<AcolyteConfig> => {
    if (existsSync(tomlPath)) {
      const rawToml = await readFile(tomlPath, "utf8");
      const parsedToml = Bun.TOML.parse(rawToml) as Record<string, unknown>;
      return toConfig(parsedToml);
    }
    if (existsSync(jsonPath)) {
      const rawJson = await readFile(jsonPath, "utf8");
      const parsedJson = JSON.parse(rawJson) as Record<string, unknown>;
      return toConfig(parsedJson);
    }
    return {};
  };
  try {
    const userConfig = await readSource(paths.userTomlPath, paths.userJsonPath);
    const projectConfig = await readSource(paths.projectTomlPath, paths.projectJsonPath);
    return toConfig({ ...userConfig, ...projectConfig } as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function readConfigSync(options?: ConfigOptions): AcolyteConfig {
  const paths = resolvePaths(options);
  const readSourceSync = (tomlPath: string, jsonPath: string): AcolyteConfig => {
    if (existsSync(tomlPath)) {
      const rawToml = readFileSync(tomlPath, "utf8");
      const parsedToml = Bun.TOML.parse(rawToml) as Record<string, unknown>;
      return toConfig(parsedToml);
    }
    if (existsSync(jsonPath)) {
      const rawJson = readFileSync(jsonPath, "utf8");
      const parsedJson = JSON.parse(rawJson) as Record<string, unknown>;
      return toConfig(parsedJson);
    }
    return {};
  };
  try {
    const userConfig = readSourceSync(paths.userTomlPath, paths.userJsonPath);
    const projectConfig = readSourceSync(paths.projectTomlPath, paths.projectJsonPath);
    return toConfig({ ...userConfig, ...projectConfig } as Record<string, unknown>);
  } catch {
    return {};
  }
}

export async function writeConfig(config: AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const paths = resolvePaths(options);
  const sanitized = toConfig(config as Record<string, unknown>);
  await mkdir(paths.userDataDir, { recursive: true });
  await writeFile(paths.userTomlPath, serializeToml(sanitized), "utf8");
}

export async function setConfigValue(key: keyof AcolyteConfig, value: string, options?: ConfigOptions): Promise<void> {
  const current = await readConfig(options);
  const next: AcolyteConfig = { ...current, [key]: value };
  await writeConfig(next, options);
}

export async function unsetConfigValue(key: keyof AcolyteConfig, options?: ConfigOptions): Promise<void> {
  const current = await readConfig(options);
  const next: AcolyteConfig = { ...current };
  delete next[key];
  await writeConfig(next, options);
}
export const __internal = {
  toConfig,
  serializeToml,
  resolvePaths,
};
