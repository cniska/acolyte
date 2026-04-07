import { z } from "zod";

const EnvSchema = z.object({
  ACOLYTE_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  GOOGLE_API_KEY: z.string().trim().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().trim().min(1).optional(),
  ACOLYTE_CLOUD_TOKEN: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parseEnv(process.env);
