import { z } from "zod";
import { agentModes } from "./agent-modes";

export const permissionModeSchema = z.enum(["read", "write"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const transportModeSchema = z.enum(["auto", "http", "rpc"]);
export type TransportMode = z.infer<typeof transportModeSchema>;

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;

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

export interface Config {
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
}

export interface ResolvedConfig {
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
}

export const CONFIG_SET_SCHEMAS: Record<keyof Config, z.ZodTypeAny> = {
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
};

export function toConfig(input: Record<string, unknown>): Config {
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
    maxPinnedMessageTokens: parseField(parseIntegerSchema(100, MAX_PINNED_MESSAGE_TOKENS), input.maxPinnedMessageTokens),
    replyTimeoutMs: parseField(parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS), input.replyTimeoutMs),
  };
}
