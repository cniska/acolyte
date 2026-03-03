import { z } from "zod";

export const providerSchema = z.enum(["openai", "anthropic", "gemini"]);
export type Provider = z.infer<typeof providerSchema>;

export const modelProviderSchema = z.enum(["openai", "openai-compatible", "anthropic", "gemini"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const providerApiEnvKeySchema = z.enum(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"]);
export type ProviderApiEnvKey = z.infer<typeof providerApiEnvKeySchema>;

export const providerApiEnvKeyByProvider: Record<Provider, ProviderApiEnvKey> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GOOGLE_API_KEY",
};
