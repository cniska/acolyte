import { appConfig } from "./app-config";
import { type ProviderCredentials, isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";

export type ProviderCredentialsMap = Partial<Record<Provider, ProviderCredentials>>;

const defaultCredentials = (): ProviderCredentialsMap => ({
  openai: appConfig.openai,
  anthropic: appConfig.anthropic,
  google: appConfig.google,
});

export function resolveModelProviderState(
  model: string,
  credentials: ProviderCredentialsMap = defaultCredentials(),
): { provider: Provider; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable(provider, credentials[provider] ?? {});
  return { provider, available };
}

export function resolveRunnableModel(
  requestedModel: string,
  credentials?: ProviderCredentialsMap,
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
