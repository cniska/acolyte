import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { defaultCredentials, type ProviderCredentialsMap } from "./agent-model";
import { unreachable } from "./assert";
import { withChatGPTAuthFetch } from "./openai-chatgpt-fetch";
import { isOpenAiSubscriptionModel } from "./openai-subscription-models";
import { mergeProviderOptions, withVercelPromptCacheFetch } from "./prompt-cache";
import { type AuthRoute, bareModelId, type ProviderCredentials, providerFromModel } from "./provider-config";
import { OPENAI_SUBSCRIPTION_BASE_URL } from "./provider-constants";
import { createRateLimitFetch, type RateLimiter } from "./rate-limiter";

/** A subscription serves only the models it lists; other OpenAI models fall back to the API key. */
export function usesOpenAiSubscription(modelId: string, credentials: ProviderCredentials): boolean {
  return Boolean(credentials.oauth) && isOpenAiSubscriptionModel(modelId);
}

export function authRouteForModel(qualifiedModel: string, credentials: ProviderCredentialsMap): AuthRoute {
  if (providerFromModel(qualifiedModel) !== "openai") return "api_key";
  return usesOpenAiSubscription(bareModelId(qualifiedModel), credentials.openai ?? {}) ? "subscription" : "api_key";
}

// The subscription backend is stateless: it rejects store:true and never persists items. The adapter
// must know this at serialization time so it inlines items instead of referencing unstored ones.
// Prototype delegation (not a spread) so the wrapper keeps the model's prototype getters, e.g. `provider`.
export function withUnstoredResponses(model: LanguageModelV4): LanguageModelV4 {
  const unstore = <T extends { providerOptions?: SharedV4ProviderOptions }>(options: T): T => ({
    ...options,
    providerOptions: mergeProviderOptions(options.providerOptions, { openai: { store: false } }),
  });
  const wrapped: LanguageModelV4 = Object.create(model);
  wrapped.doStream = (options) => model.doStream(unstore(options));
  wrapped.doGenerate = (options) => model.doGenerate(unstore(options));
  return wrapped;
}

export function createModel(
  qualifiedModel: string,
  rateLimiter: RateLimiter,
  credentials?: ProviderCredentialsMap,
): LanguageModelV4 {
  const creds = credentials ?? defaultCredentials();
  const provider = providerFromModel(qualifiedModel);
  const modelId = bareModelId(qualifiedModel);
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
      if (usesOpenAiSubscription(modelId, providerCreds)) {
        const openai = createOpenAI({
          apiKey: "chatgpt-oauth",
          baseURL: OPENAI_SUBSCRIPTION_BASE_URL,
          fetch: withChatGPTAuthFetch(fetchFn) as typeof globalThis.fetch,
        });
        return withUnstoredResponses(openai(modelId));
      }
      const openai = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: fetchFn,
      });
      return openai(modelId);
    }
    case "vercel": {
      const vercelFetch = withVercelPromptCacheFetch(fetchFn);
      const vercel = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
        fetch: vercelFetch,
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
