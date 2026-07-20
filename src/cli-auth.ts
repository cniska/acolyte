import { CodedError } from "./coded-error";
import { errorMessage } from "./error-contract";
import { t } from "./i18n";
import type { OAuthProvider, OAuthTokenSet } from "./oauth-store-contract";
import { oauthProviderSchema } from "./oauth-store-contract";
import { buildAuthorizeUrl, createPkce } from "./openai-oauth";
import type { OAuthCallbackServer, OAuthServerErrorKind } from "./openai-oauth-server";
import {
  type Provider,
  type ProviderApiEnvKey,
  providerApiEnvKeyByProvider,
  providerSchema,
} from "./provider-contract";

type AuthModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  prompt: (question: string) => string | null;
  promptHidden: (question: string) => Promise<string | undefined>;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  openBrowser: (url: string) => void;
  createState: () => string;
  startCallbackServer: (state: string) => OAuthCallbackServer;
  exchangeCode: (input: { code: string; verifier: string }) => Promise<OAuthTokenSet>;
  writeOAuthTokens: (provider: OAuthProvider, tokens: OAuthTokenSet) => Promise<void>;
  removeOAuthTokens: (provider: OAuthProvider) => Promise<void>;
  readOAuthTokens: (provider: OAuthProvider) => OAuthTokenSet | undefined;
  readProviderApiKeys: () => Partial<Record<ProviderApiEnvKey, string>>;
  readConfiguredProviderApiKeys: () => Partial<Record<Provider, string>>;
  writeProviderApiKey: (envKey: ProviderApiEnvKey, value: string) => Promise<void>;
  removeProviderApiKey: (envKey: ProviderApiEnvKey) => Promise<void>;
  credentialsPath: () => string;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

type AuthMethod = "key" | "subscription";

type ParsedAuthArgs = {
  provider?: string;
  logout: boolean;
  key: boolean;
  subscription: boolean;
  extra: boolean;
};

const PROVIDERS = providerSchema.options;
const PROVIDER_LIST = PROVIDERS.join("|");

function parseProvider(value: string | undefined): Provider | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = providerSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

function supportsSubscription(provider: Provider): provider is OAuthProvider {
  return oauthProviderSchema.safeParse(provider).success;
}

function parseAuthArgs(args: string[]): ParsedAuthArgs {
  let logout = false;
  let key = false;
  let subscription = false;
  const positional: string[] = [];
  for (const token of args) {
    if (token === "--logout") {
      logout = true;
      continue;
    }
    if (token === "--key") {
      key = true;
      continue;
    }
    if (token === "--subscription") {
      subscription = true;
      continue;
    }
    positional.push(token);
  }
  return {
    provider: positional[0],
    logout,
    key,
    subscription,
    extra: positional.length > 1,
  };
}

function authErrorMessage(error: unknown): string {
  const kind = error instanceof CodedError ? (error.kind as OAuthServerErrorKind | undefined) : undefined;
  if (kind === "port_in_use") return t("cli.auth.port_in_use");
  if (kind === "timeout") return t("cli.auth.timeout");
  return t("cli.auth.failed", { reason: errorMessage(error) });
}

function methodLabels(methods: string[]): string {
  if (methods.length === 0) return t("cli.auth.status.none_method");
  return methods.join(" + ");
}

function printStatus(deps: AuthModeDeps): void {
  const keys = deps.readConfiguredProviderApiKeys();
  const apiKeyLabel = t("status.provider_auth.api_key");
  const subscriptionLabel = t("status.provider_auth.subscription");
  for (const provider of PROVIDERS) {
    const methods: string[] = [];
    if (supportsSubscription(provider) && deps.readOAuthTokens(provider) !== undefined) {
      methods.push(subscriptionLabel);
    }
    if (keys[provider]) methods.push(apiKeyLabel);
    deps.printDim(t("cli.auth.status.line", { provider, methods: methodLabels(methods) }));
  }
}

async function saveApiKey(provider: Provider, deps: AuthModeDeps): Promise<void> {
  const envKey = providerApiEnvKeyByProvider[provider];
  if (deps.readProviderApiKeys()[envKey]) {
    const answer = deps.prompt(t("cli.auth.override.confirm", { envKey }))?.trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      deps.printDim(t("cli.auth.override.cancelled"));
      return;
    }
  }
  const apiKey = await deps.promptHidden(t("cli.auth.prompt.api_key"));
  if (!apiKey) {
    deps.printError(t("cli.auth.api_key.empty", { envKey }));
    process.exitCode = 1;
    return;
  }
  await deps.writeProviderApiKey(envKey, apiKey);
  deps.printDim(t("cli.auth.saved", { envKey, path: deps.credentialsPath() }));
}

async function loginSubscription(provider: OAuthProvider, deps: AuthModeDeps): Promise<void> {
  if (provider !== "openai") {
    deps.printError(t("cli.auth.subscription.unsupported", { provider }));
    process.exitCode = 1;
    return;
  }
  if (deps.readOAuthTokens(provider) !== undefined) {
    const answer = deps.prompt(t("cli.auth.subscription.override.confirm", { provider }))?.trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      deps.printDim(t("cli.auth.subscription.override.cancelled"));
      return;
    }
  }

  const pkce = createPkce();
  const state = deps.createState();

  let server: OAuthCallbackServer;
  try {
    server = deps.startCallbackServer(state);
  } catch (error) {
    deps.printError(authErrorMessage(error));
    process.exitCode = 1;
    return;
  }

  const authUrl = buildAuthorizeUrl({ challenge: pkce.challenge, state });
  deps.printDim(t("cli.auth.opening"));
  deps.openBrowser(authUrl);
  deps.printDim(authUrl);
  deps.printDim(t("cli.auth.waiting"));

  try {
    const { code } = await server.result;
    const tokens = await deps.exchangeCode({ code, verifier: pkce.verifier });
    await deps.writeOAuthTokens(provider, tokens);
    deps.printDim(t("cli.auth.success"));
  } catch (error) {
    void server.stop();
    deps.printError(authErrorMessage(error));
    process.exitCode = 1;
  }
}

async function logoutProvider(provider: Provider, deps: AuthModeDeps): Promise<void> {
  const envKey = providerApiEnvKeyByProvider[provider];
  const hadKey = Boolean(deps.readProviderApiKeys()[envKey]);
  const hadSubscription = supportsSubscription(provider) && deps.readOAuthTokens(provider) !== undefined;
  if (!hadKey && !hadSubscription) {
    deps.printDim(t("cli.auth.logout_none", { provider }));
    return;
  }
  if (hadKey) await deps.removeProviderApiKey(envKey);
  if (hadSubscription && supportsSubscription(provider)) await deps.removeOAuthTokens(provider);
  deps.printDim(t("cli.auth.logout", { provider }));
}

function parseMethodChoice(raw: string | null | undefined): AuthMethod | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "key" || value === "k" || value === "api" || value === "api_key" || value === "api-key") return "key";
  if (value === "subscription" || value === "s" || value === "oauth") return "subscription";
  return null;
}

async function resolveMethod(
  provider: Provider,
  parsed: ParsedAuthArgs,
  deps: AuthModeDeps,
): Promise<AuthMethod | null> {
  if (parsed.key && parsed.subscription) {
    deps.printError(t("cli.auth.method.conflict"));
    process.exitCode = 1;
    return null;
  }
  if (parsed.subscription) {
    if (!supportsSubscription(provider)) {
      deps.printError(t("cli.auth.subscription.unsupported", { provider }));
      process.exitCode = 1;
      return null;
    }
    return "subscription";
  }
  if (parsed.key || !supportsSubscription(provider)) return "key";

  const choice = parseMethodChoice(deps.prompt(t("cli.auth.prompt.method")));
  if (!choice) {
    deps.printError(t("cli.auth.method.invalid"));
    process.exitCode = 1;
    return null;
  }
  return choice;
}

export async function authMode(args: string[], deps: AuthModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("auth");
    return;
  }

  const parsed = parseAuthArgs(args);
  if (parsed.extra) {
    deps.commandError("auth");
    return;
  }

  if (parsed.provider === undefined) {
    if (parsed.logout || parsed.key || parsed.subscription) {
      deps.commandError("auth", t("cli.auth.provider.required"));
      process.exitCode = 1;
      return;
    }
    printStatus(deps);
    return;
  }

  const provider = parseProvider(parsed.provider);
  if (!provider) {
    deps.printError(t("cli.auth.invalid_provider", { providers: PROVIDER_LIST }));
    process.exitCode = 1;
    return;
  }

  if (parsed.logout) {
    await logoutProvider(provider, deps);
    return;
  }

  const method = await resolveMethod(provider, parsed, deps);
  if (!method) return;

  if (method === "subscription") {
    if (!supportsSubscription(provider)) {
      deps.printError(t("cli.auth.subscription.unsupported", { provider }));
      process.exitCode = 1;
      return;
    }
    await loginSubscription(provider, deps);
    return;
  }

  await saveApiKey(provider, deps);
}
