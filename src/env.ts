import { z } from "zod";

const MAX_CONTEXT_TOKENS = 32_000;
const MAX_OM_OBSERVATION_TOKENS = 12_000;
const MAX_OM_REFLECTION_TOKENS = 32_000;
const MAX_MESSAGE_TOKENS = 4_000;
const MAX_ATTACHMENT_MESSAGE_TOKENS = 12_000;
const MAX_PINNED_MESSAGE_TOKENS = 4_000;
const ProviderSchema = z.enum(["openai", "anthropic", "gemini", "openai-compatible", "mock"]);

const EnvSchema = z.object({
  PORT: z.preprocess((value) => (value === undefined ? 6767 : value), z.coerce.number().int().min(1).max(65535)),
  ACOLYTE_API_KEY: z.string().trim().min(1).optional(),
  ACOLYTE_API_URL: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_BASE_URL: z.string().trim().min(1).default("https://api.openai.com/v1"),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().trim().min(1).default("https://api.anthropic.com"),
  GOOGLE_API_KEY: z.string().trim().min(1).optional(),
  GOOGLE_BASE_URL: z.string().trim().min(1).optional(),
  ACOLYTE_PROVIDER: ProviderSchema.default("openai"),
  ACOLYTE_PROVIDER_PLANNER: ProviderSchema.optional(),
  ACOLYTE_PROVIDER_CODER: ProviderSchema.optional(),
  ACOLYTE_PROVIDER_REVIEWER: ProviderSchema.optional(),
  ACOLYTE_MODEL: z.string().trim().min(1).default("gpt-5-mini"),
  ACOLYTE_MODEL_PLANNER: z.string().trim().min(1).optional(),
  ACOLYTE_MODEL_CODER: z.string().trim().min(1).optional(),
  ACOLYTE_MODEL_REVIEWER: z.string().trim().min(1).optional(),
  ACOLYTE_OM_MODEL: z.string().trim().min(1).optional(),
  ACOLYTE_OM_OBSERVATION_TOKENS: z.preprocess(
    (value) => (value === undefined ? 3_000 : value),
    z.coerce.number().int().min(500).max(MAX_OM_OBSERVATION_TOKENS),
  ),
  ACOLYTE_OM_REFLECTION_TOKENS: z.preprocess(
    (value) => (value === undefined ? 8_000 : value),
    z.coerce.number().int().min(1000).max(MAX_OM_REFLECTION_TOKENS),
  ),
  ACOLYTE_CONTEXT_MAX_TOKENS: z.preprocess(
    (value) => (value === undefined ? 8_000 : value),
    z.coerce.number().int().min(1000).max(MAX_CONTEXT_TOKENS),
  ),
  ACOLYTE_MAX_HISTORY_MESSAGES: z.preprocess(
    (value) => (value === undefined ? 40 : value),
    z.coerce.number().int().min(1).max(200),
  ),
  ACOLYTE_MAX_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 600 : value),
    z.coerce.number().int().min(50).max(MAX_MESSAGE_TOKENS),
  ),
  ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 3_000 : value),
    z.coerce.number().int().min(100).max(MAX_ATTACHMENT_MESSAGE_TOKENS),
  ),
  ACOLYTE_MAX_PINNED_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 1_200 : value),
    z.coerce.number().int().min(100).max(MAX_PINNED_MESSAGE_TOKENS),
  ),
  ACOLYTE_PERMISSION_MODE: z.enum(["read", "write"]).default("read"),
});

export type AcolyteEnv = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): AcolyteEnv {
  const result = EnvSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parseEnv(process.env);
