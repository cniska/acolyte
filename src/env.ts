import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.preprocess((value) => (value === undefined ? 6767 : value), z.coerce.number().int().min(1).max(65535)),
  ACOLYTE_API_KEY: z.string().trim().min(1).optional(),
  ACOLYTE_API_URL: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_BASE_URL: z.string().trim().min(1).default("https://api.openai.com/v1"),
  ACOLYTE_MODEL: z.string().trim().min(1).default("gpt-5-mini"),
  ACOLYTE_MODEL_PLANNER: z.string().trim().min(1).optional(),
  ACOLYTE_MODEL_CODER: z.string().trim().min(1).optional(),
  ACOLYTE_MODEL_REVIEWER: z.string().trim().min(1).optional(),
  ACOLYTE_OM_MODEL: z.string().trim().min(1).optional(),
  ACOLYTE_OM_OBSERVATION_TOKENS: z.preprocess(
    (value) => (value === undefined ? 3_000 : value),
    z.coerce.number().int().min(500),
  ),
  ACOLYTE_OM_REFLECTION_TOKENS: z.preprocess(
    (value) => (value === undefined ? 8_000 : value),
    z.coerce.number().int().min(1000),
  ),
  ACOLYTE_CONTEXT_MAX_TOKENS: z.preprocess(
    (value) => (value === undefined ? 8_000 : value),
    z.coerce.number().int().min(1000),
  ),
  ACOLYTE_MAX_HISTORY_MESSAGES: z.preprocess(
    (value) => (value === undefined ? 40 : value),
    z.coerce.number().int().min(1).max(200),
  ),
  ACOLYTE_MAX_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 600 : value),
    z.coerce.number().int().min(50),
  ),
  ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 3_000 : value),
    z.coerce.number().int().min(100),
  ),
  ACOLYTE_MAX_PINNED_MESSAGE_TOKENS: z.preprocess(
    (value) => (value === undefined ? 1_200 : value),
    z.coerce.number().int().min(100),
  ),
  ACOLYTE_PERMISSION_MODE: z.enum(["read", "write"]).default("write"),
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
