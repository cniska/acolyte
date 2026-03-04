import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { appConfig } from "./app-config";
import { providerFromModel } from "./provider-config";

export function createModel(qualifiedModel: string): LanguageModelV3 {
  const provider = providerFromModel(qualifiedModel);
  const slash = qualifiedModel.indexOf("/");
  const modelId = slash >= 0 ? qualifiedModel.slice(slash + 1) : qualifiedModel;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: appConfig.anthropic.apiKey,
        ...(appConfig.anthropic.baseUrl ? { baseURL: appConfig.anthropic.baseUrl } : {}),
      });
      return anthropic(modelId);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: appConfig.google.apiKey,
        ...(appConfig.google.baseUrl ? { baseURL: appConfig.google.baseUrl } : {}),
      });
      return google(modelId);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: appConfig.openai.apiKey,
        ...(appConfig.openai.baseUrl ? { baseURL: appConfig.openai.baseUrl } : {}),
      });
      return openai(modelId);
    }
  }
}
