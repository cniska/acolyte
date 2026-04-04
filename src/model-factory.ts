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
  rateLimiter: RateLimiter,
  credentials?: ProviderCredentialsMap,
): LanguageModelV3 {
  const creds = credentials ?? defaultCredentials();
  const provider = providerFromModel(qualifiedModel);
  const slash = qualifiedModel.indexOf("/");
  const modelId = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;
  const providerCreds = creds[provider] ?? {};
  const fetchFn = createRateLimitFetch(rateLimiter, globalThis.fetch) as typeof globalThis.fetch;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: fetchFn,
      });
      return anthropic(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: fetchFn,
      });
      return google(modelId);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: fetchFn,
      });
      return openai(modelId);
    }
    case "vercel": {
      const vercel = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: fetchFn,
      });
      // The gateway expects provider/model format (e.g. "anthropic/claude-sonnet-4").
      // When explicitly prefixed with vercel/, strip that prefix.
      const gatewayModelId = qualifiedModel.startsWith("vercel/")
        ? qualifiedModel.slice("vercel/".length)
        : qualifiedModel;
      return vercel(gatewayModelId);
    }
    default:
      return unreachable(provider);
  }
}
