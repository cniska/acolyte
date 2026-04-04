import { z } from "zod";

export const providerSchema = z.enum(["openai", "anthropic", "google", "vercel"]);
export type Provider = z.infer<typeof providerSchema>;

export const providerApiEnvKeySchema = z.enum([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "AI_GATEWAY_API_KEY",
]);
export type ProviderApiEnvKey = z.infer<typeof providerApiEnvKeySchema>;

export const providerApiEnvKeyByProvider: Record<Provider, ProviderApiEnvKey> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  vercel: "AI_GATEWAY_API_KEY",
};
