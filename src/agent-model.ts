import { appConfig } from "./app-config";
import { isProviderAvailable, type ProviderName, providerFromModel } from "./provider-config";

export type ModelCredentials = {
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
};

export function resolveModelProviderState(
  model: string,
  credentials: ModelCredentials = {
    openaiApiKey: appConfig.openai.apiKey,
    openaiBaseUrl: appConfig.openai.baseUrl,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  },
): { provider: ProviderName; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable({
    provider,
    openaiApiKey: credentials.openaiApiKey,
    openaiBaseUrl: credentials.openaiBaseUrl,
    anthropicApiKey: credentials.anthropicApiKey,
    googleApiKey: credentials.googleApiKey,
  });
  return { provider, available };
}

export function resolveRunnableModel(
  requestedModel: string,
  credentials?: ModelCredentials,
): {
  model: string;
  provider: ProviderName;
  available: boolean;
} {
  const state = resolveModelProviderState(requestedModel, credentials);
  return {
    model: requestedModel,
    provider: state.provider,
    available: state.available,
  };
}
