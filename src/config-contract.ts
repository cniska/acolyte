import { z } from "zod";
import { type AgentMode, agentModeSchema } from "./agent-contract";
import { type TranslationLocale, translationLocaleSchema } from "./i18n/locales";

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const transportModeSchema = z.literal("rpc");

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;
export const memorySourceIdSchema = z.enum(["stored", "distill_user", "distill_project", "distill_session"]);
export type MemorySourceId = z.infer<typeof memorySourceIdSchema>;

const MAX_CONTEXT_TOKENS = 32_000;
const MAX_DISTILL_MAX_OUTPUT_TOKENS = 4_000;
const MAX_DISTILL_REFLECTION_THRESHOLD_TOKENS = 32_000;
const MAX_MEMORY_BUDGET_TOKENS = 8_000;
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
const parseMemorySourcesSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}, z.array(memorySourceIdSchema).min(1));
const MODE_MODEL_KEYS = new Set<string>([...agentModeSchema.options]);
const modeTemperatureMapSchema = z
  .record(
    z.string(),
    z.preprocess(
      (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
      z.number().min(0).max(MAX_TEMPERATURE),
    ),
  )
  .transform((input) =>
    Object.fromEntries(Object.entries(input).filter(([mode]) => agentModeSchema.options.includes(mode as AgentMode))),
  );

export function isModeModelKey(key: string): boolean {
  return MODE_MODEL_KEYS.has(key);
}

export interface Config {
  port?: number;
  locale?: TranslationLocale;
  model?: string;
  models?: Record<string, string>;
  temperatures?: Record<string, number>;
  distillModel?: string;
  distillMessageThreshold?: number;
  distillReflectionThresholdTokens?: number;
  distillMaxOutputTokens?: number;
  memoryBudgetTokens?: number;
  memorySources?: MemorySourceId[];
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  googleBaseUrl?: string;
  logFormat?: LogFormat;
  transportMode?: "rpc";
  contextMaxTokens?: number;
  maxHistoryMessages?: number;
  maxMessageTokens?: number;
  maxAttachmentMessageTokens?: number;
  maxPinnedMessageTokens?: number;
  replyTimeoutMs?: number;
  embeddingModel?: string;
}

export interface ResolvedConfig {
  port: number;
  locale: TranslationLocale;
  model: string;
  models: Record<string, string>;
  temperatures: Record<string, number>;
  distillModel: string;
  distillMessageThreshold: number;
  distillReflectionThresholdTokens: number;
  distillMaxOutputTokens: number;
  memoryBudgetTokens: number;
  memorySources: MemorySourceId[];
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  googleBaseUrl: string;
  logFormat: LogFormat;
  transportMode: "rpc";
  contextMaxTokens: number;
  maxHistoryMessages: number;
  maxMessageTokens: number;
  maxAttachmentMessageTokens: number;
  maxPinnedMessageTokens: number;
  replyTimeoutMs: number;
  embeddingModel: string;
}

export const CONFIG_SET_SCHEMAS: Partial<Record<keyof Config, z.ZodTypeAny>> = {
  port: parseIntegerSchema(1, 65535),
  locale: translationLocaleSchema,
  model: nonEmptyStringSchema,
  models: z.record(z.string(), nonEmptyStringSchema),
  temperatures: modeTemperatureMapSchema,
  openaiBaseUrl: nonEmptyStringSchema,
  anthropicBaseUrl: nonEmptyStringSchema,
  googleBaseUrl: nonEmptyStringSchema,
  logFormat: logFormatSchema,
  embeddingModel: nonEmptyStringSchema,
};

export function toConfig(input: Record<string, unknown>): Config {
  const parseField = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  };

  return {
    port: parseField(parseIntegerSchema(1, 65535), input.port),
    locale: parseField(translationLocaleSchema, input.locale),
    model: parseField(nonEmptyStringSchema, input.model),
    models:
      typeof input.models === "object" && input.models !== null
        ? Object.fromEntries(
            Object.entries(input.models as Record<string, unknown>).flatMap(([k, v]) => {
              if (!isModeModelKey(k)) return [];
              const result = nonEmptyStringSchema.safeParse(v);
              return result.success ? [[k, result.data]] : [];
            }),
          )
        : undefined,
    temperatures:
      typeof input.temperatures === "object" && input.temperatures !== null
        ? Object.fromEntries(
            Object.entries(input.temperatures as Record<string, unknown>).flatMap(([k, v]) => {
              if (!agentModeSchema.options.includes(k as AgentMode)) return [];
              const result = parseTemperatureSchema.safeParse(v);
              return result.success ? [[k, result.data]] : [];
            }),
          )
        : undefined,
    distillModel: parseField(nonEmptyStringSchema, input.distillModel),
    distillMessageThreshold: parseField(parseIntegerSchema(1, 200), input.distillMessageThreshold),
    distillReflectionThresholdTokens: parseField(
      parseIntegerSchema(1000, MAX_DISTILL_REFLECTION_THRESHOLD_TOKENS),
      input.distillReflectionThresholdTokens,
    ),
    distillMaxOutputTokens: parseField(
      parseIntegerSchema(100, MAX_DISTILL_MAX_OUTPUT_TOKENS),
      input.distillMaxOutputTokens,
    ),
    memoryBudgetTokens: parseField(parseIntegerSchema(0, MAX_MEMORY_BUDGET_TOKENS), input.memoryBudgetTokens),
    memorySources: parseField(parseMemorySourcesSchema, input.memorySources),
    openaiBaseUrl: parseField(nonEmptyStringSchema, input.openaiBaseUrl),
    anthropicBaseUrl: parseField(nonEmptyStringSchema, input.anthropicBaseUrl),
    googleBaseUrl: parseField(nonEmptyStringSchema, input.googleBaseUrl),
    logFormat: parseField(logFormatSchema, input.logFormat),
    transportMode: parseField(transportModeSchema, input.transportMode),
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
    embeddingModel: parseField(nonEmptyStringSchema, input.embeddingModel),
  };
}
