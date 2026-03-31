import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { defaultCredentials, type ProviderCredentialsMap } from "./agent-model";
import { unreachable } from "./assert";
import { providerFromModel } from "./provider-config";
import { createRateLimitFetch, type RateLimiter } from "./rate-limiter";

export function createModel(
  qualifiedModel: string,
  credentials?: ProviderCredentialsMap,
  rateLimiter?: RateLimiter,
): LanguageModelV3 {
  const creds = credentials ?? defaultCredentials();
  const provider = providerFromModel(qualifiedModel);
  const slash = qualifiedModel.indexOf("/");
  const modelId = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;
  const providerCreds = creds[provider] ?? {};
  const fetchFn = rateLimiter
    ? (createRateLimitFetch(rateLimiter, globalThis.fetch) as typeof globalThis.fetch)
    : undefined;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      return anthropic(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      return google(modelId);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      return openai(modelId);
    }
    default:
      return unreachable(provider);
  }
}
