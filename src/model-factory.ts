import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { appConfig } from "./app-config";
import { unreachable } from "./assert";
import type { ProviderCredentials } from "./provider-config";
import { providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";

export type ModelCredentials = Partial<Record<Provider, ProviderCredentials>>;

const defaultCredentials = (): ModelCredentials => ({
  openai: appConfig.openai,
  anthropic: appConfig.anthropic,
  google: appConfig.google,
});

export function createModel(qualifiedModel: string, credentials?: ModelCredentials): LanguageModelV3 {
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
