import { appConfig } from "./app-config";
import { isProviderAvailable, type ProviderCredentials, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";

export type ProviderCredentialsMap = Partial<Record<Provider, ProviderCredentials>>;

export const defaultCredentials = (): ProviderCredentialsMap => ({
  openai: appConfig.openai,
  anthropic: appConfig.anthropic,
  google: appConfig.google,
  vercel: appConfig.vercel,
});

export function resolveModelProviderState(
  model: string,
  credentials: ProviderCredentialsMap = defaultCredentials(),
): { provider: Provider; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable(provider, credentials[provider] ?? {});
  if (available) return { provider, available };
  // Fall back to Vercel AI Gateway when direct provider is unavailable.
  if (provider !== "vercel" && isProviderAvailable("vercel", credentials.vercel ?? {})) {
    return { provider: "vercel", available: true };
  }
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
