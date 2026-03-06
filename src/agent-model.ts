import { appConfig } from "./app-config";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";

export type ModelCredentials = {
  openaiApiKey?: string;
  openaiBaseUrl: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  googleApiKey?: string;
};

export function resolveModelProviderState(
  model: string,
  credentials: ModelCredentials = {
    openaiApiKey: appConfig.openai.apiKey,
    openaiBaseUrl: appConfig.openai.baseUrl,
    anthropicApiKey: appConfig.anthropic.apiKey,
    anthropicBaseUrl: appConfig.anthropic.baseUrl,
    googleApiKey: appConfig.google.apiKey,
  },
): { provider: Provider; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable({
    provider,
    openaiApiKey: credentials.openaiApiKey,
    openaiBaseUrl: credentials.openaiBaseUrl,
    anthropicApiKey: credentials.anthropicApiKey,
    anthropicBaseUrl: credentials.anthropicBaseUrl,
    googleApiKey: credentials.googleApiKey,
  });
  return { provider, available };
}

export function resolveRunnableModel(
  requestedModel: string,
  credentials?: ModelCredentials,
): {
  model: string;
  provider: Provider;
  available: boolean;
} {
  const state = resolveModelProviderState(requestedModel, credentials);
  return {
    model: requestedModel,
    provider: state.provider,
    available: state.available,
  };
}
