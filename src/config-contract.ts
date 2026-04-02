import { z } from "zod";
import { type TranslationLocale, translationLocaleSchema } from "./i18n/locales";

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const transportModeSchema = z.literal("rpc");

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;

const MAX_CONTEXT_TOKENS = 32_000;
const MAX_DISTILL_MAX_OUTPUT_TOKENS = 4_000;
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

export interface Config {
  port?: number;
  locale?: TranslationLocale;
  model?: string;
  temperature?: number;
  distillModel?: string;
  distillMessageThreshold?: number;
  distillMaxOutputTokens?: number;
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
  temperature?: number;
  distillModel: string;
  distillMessageThreshold: number;
  distillMaxOutputTokens: number;
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
  temperature: parseTemperatureSchema,
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
    temperature: parseField(parseTemperatureSchema, input.temperature),
    distillModel: parseField(nonEmptyStringSchema, input.distillModel),
    distillMessageThreshold: parseField(parseIntegerSchema(1, 200), input.distillMessageThreshold),
    distillMaxOutputTokens: parseField(
      parseIntegerSchema(100, MAX_DISTILL_MAX_OUTPUT_TOKENS),
      input.distillMaxOutputTokens,
    ),
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
