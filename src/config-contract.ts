import { z } from "zod";
import { type TranslationLocale, translationLocaleSchema } from "./i18n/locales";

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;

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
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  googleBaseUrl?: string;
  logFormat?: LogFormat;
  replyTimeoutMs?: number;
  embeddingModel?: string;
}

export interface ResolvedConfig {
  port: number;
  locale: TranslationLocale;
  model: string;
  temperature?: number;
  distillModel: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  googleBaseUrl: string;
  logFormat: LogFormat;
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
    openaiBaseUrl: parseField(nonEmptyStringSchema, input.openaiBaseUrl),
    anthropicBaseUrl: parseField(nonEmptyStringSchema, input.anthropicBaseUrl),
    googleBaseUrl: parseField(nonEmptyStringSchema, input.googleBaseUrl),
    logFormat: parseField(logFormatSchema, input.logFormat),
    replyTimeoutMs: parseField(parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS), input.replyTimeoutMs),
    embeddingModel: parseField(nonEmptyStringSchema, input.embeddingModel),
  };
}
