import { t } from "./i18n";
import type { Provider } from "./provider-contract";

export type ProviderAuthPresence = {
  anthropicApiKey: boolean;
  googleApiKey: boolean;
  openaiSubscription: boolean;
  openaiApiKey: boolean;
  vercelApiKey: boolean;
};

export type ProviderStatus = { providers: Provider[]; providerAuth: string[] };

export function collectProviderStatus(presence: ProviderAuthPresence): ProviderStatus {
  const providers: Provider[] = [];
  const providerAuth: string[] = [];
  const add = (provider: Provider, methods: string[]): void => {
    if (methods.length === 0) return;
    providers.push(provider);
    providerAuth.push(`${provider} (${methods.join(" + ")})`);
  };
  const apiKey = t("status.provider_auth.api_key");
  const subscription = t("status.provider_auth.subscription");

  add("anthropic", presence.anthropicApiKey ? [apiKey] : []);
  add("google", presence.googleApiKey ? [apiKey] : []);
  // Both can be in effect at once: the subscription serves the gpt-5 family, the key serves the rest.
  const openaiMethods: string[] = [];
  if (presence.openaiSubscription) openaiMethods.push(subscription);
  if (presence.openaiApiKey) openaiMethods.push(apiKey);
  add("openai", openaiMethods);
  add("vercel", presence.vercelApiKey ? [apiKey] : []);

  return { providers, providerAuth };
}
