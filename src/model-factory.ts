import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { defaultCredentials, type ProviderCredentialsMap } from "./agent-model";
import { unreachable } from "./assert";
import { providerFromModel } from "./provider-config";

export function createModel(qualifiedModel: string, credentials?: ProviderCredentialsMap): LanguageModelV3 {
  const creds = credentials ?? defaultCredentials();
  const provider = providerFromModel(qualifiedModel);
  const slash = qualifiedModel.indexOf("/");
  const modelId = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;
  const providerCreds = creds[provider] ?? {};

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      return anthropic(modelId);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      return google(modelId);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: providerCreds.apiKey,
        ...(providerCreds.baseUrl ? { baseURL: providerCreds.baseUrl } : {}),
      });
      return openai(modelId);
    }
    default:
      return unreachable(provider);
  }
}
