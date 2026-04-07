import { z } from "zod";
import { type FeatureFlags, featureFlagsSchema, type ResolvedFeatureFlags } from "./feature-flags-contract";
import { type TranslationLocale, translationLocaleSchema } from "./i18n/locales";

export const logFormatSchema = z.enum(["logfmt", "json"]);
export type LogFormat = z.infer<typeof logFormatSchema>;

export const scopeSchema = z.enum(["user", "project"]);
export type ConfigScope = z.infer<typeof scopeSchema>;

const MAX_RUN_REPLY_TIMEOUT_MS = 600_000;
const MAX_TEMPERATURE = 2;

export const reasoningLevelSchema = z.enum(["low", "medium", "high"]);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

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
  vercelBaseUrl?: string;
  logFormat?: LogFormat;
  replyTimeoutMs?: number;
  reasoning?: ReasoningLevel;
  embeddingModel?: string;
  cloudUrl?: string;
  features?: FeatureFlags;
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
  vercelBaseUrl: string;
  logFormat: LogFormat;
  replyTimeoutMs: number;
  reasoning?: ReasoningLevel;
  embeddingModel: string;
  cloudUrl?: string;
  features: ResolvedFeatureFlags;
}

export const CONFIG_SET_SCHEMAS: Partial<Record<keyof Config, z.ZodTypeAny>> = {
  port: parseIntegerSchema(1, 65535),
  locale: translationLocaleSchema,
  model: nonEmptyStringSchema,
  temperature: parseTemperatureSchema,
  openaiBaseUrl: nonEmptyStringSchema,
  anthropicBaseUrl: nonEmptyStringSchema,
  googleBaseUrl: nonEmptyStringSchema,
  vercelBaseUrl: nonEmptyStringSchema,
  logFormat: logFormatSchema,
  reasoning: reasoningLevelSchema,
  embeddingModel: nonEmptyStringSchema,
  cloudUrl: nonEmptyStringSchema,
  features: featureFlagsSchema,
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
    vercelBaseUrl: parseField(nonEmptyStringSchema, input.vercelBaseUrl),
    logFormat: parseField(logFormatSchema, input.logFormat),
    replyTimeoutMs: parseField(parseIntegerSchema(1_000, MAX_RUN_REPLY_TIMEOUT_MS), input.replyTimeoutMs),
    reasoning: parseField(reasoningLevelSchema, input.reasoning),
    embeddingModel: parseField(nonEmptyStringSchema, input.embeddingModel),
    cloudUrl: parseField(nonEmptyStringSchema, input.cloudUrl),
    features: parseField(featureFlagsSchema, input.features),
  };
}
