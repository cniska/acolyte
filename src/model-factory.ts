import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { defaultCredentials, type ProviderCredentialsMap } from "./agent-model";
import { unreachable } from "./assert";
import { CodedError } from "./coded-error";
import { ERROR_KINDS, PROVIDER_ERROR_CODES } from "./error-contract";
import { withChatGPTAuthFetch } from "./openai-chatgpt-fetch";
import { subscriptionModels } from "./openai-subscription-models";
import type { Env } from "./paths";
import { mergeProviderOptions, withVercelPromptCacheFetch } from "./prompt-cache";
import { type AuthRoute, bareModelId, type ProviderCredentials, providerFromModel } from "./provider-config";
import { OPENAI_SUBSCRIPTION_BASE_URL } from "./provider-constants";
import { createRateLimitFetch, type FetchFn, type RateLimiter } from "./rate-limiter";

/**
 * Which credential a model will run on. Async because a subscription serves only the models it
 * lists, and that list is a network answer: producing the route is the only way to have asked.
 */
export async function resolveAuthRoute(
  qualifiedModel: string,
  credentials?: ProviderCredentialsMap,
  fetchFn: FetchFn = globalThis.fetch,
  env?: Env,
): Promise<AuthRoute> {
  if (providerFromModel(qualifiedModel) !== "openai") return "api_key";
  const openai = (credentials ?? defaultCredentials()).openai ?? {};
  if (!openai.oauth) return "api_key";
  const served = await subscriptionModels(fetchFn, env);
  if (served.has(bareModelId(qualifiedModel))) return "subscription";
  if (openai.apiKey) return "api_key";
  throw new CodedError(
    PROVIDER_ERROR_CODES.modelNotOnSubscription,
    `Your OpenAI subscription does not serve "${bareModelId(qualifiedModel)}". It serves ${[...served].sort().join(", ") || "no models"}. Set OPENAI_API_KEY to use other OpenAI models.`,
    { kind: ERROR_KINDS.modelNotOnSubscription },
  );
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
  route: AuthRoute,
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
      if (route === "subscription") {
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
