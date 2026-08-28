import { alignCols } from "./chat-format";
import type { SelectOption } from "./cli-select";
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
  interactive: boolean;
  prompt: (question: string) => string | null;
  selectOption: <T>(options: SelectOption<T>[]) => Promise<T | undefined>;
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

function providerMethods(provider: Provider, deps: AuthModeDeps): string[] {
  const methods: string[] = [];
  if (supportsSubscription(provider) && deps.readOAuthTokens(provider) !== undefined) {
    methods.push(t("status.provider_auth.subscription"));
  }
  if (deps.readConfiguredProviderApiKeys()[provider]) methods.push(t("status.provider_auth.api_key"));
  return methods;
}

function printStatus(deps: AuthModeDeps): void {
  for (const provider of PROVIDERS) {
    deps.printDim(t("cli.auth.status.line", { provider, methods: methodLabels(providerMethods(provider, deps)) }));
  }
}

/** Rows are a name and what it authenticates with, in columns: a picker has no prose to punctuate. */
function selectProvider(deps: AuthModeDeps): Promise<Provider | undefined> {
  const labels = alignCols(PROVIDERS.map((provider) => [provider, methodLabels(providerMethods(provider, deps))]));
  return deps.selectOption(PROVIDERS.map((provider, row) => ({ value: provider, label: labels[row] ?? provider })));
}

function selectMethod(deps: AuthModeDeps): Promise<AuthMethod | undefined> {
  return deps.selectOption<AuthMethod>([
    { value: "subscription", label: t("status.provider_auth.subscription") },
    { value: "key", label: t("status.provider_auth.api_key") },
  ]);
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

async function logoutProvider(provider: Provider, method: AuthMethod | undefined, deps: AuthModeDeps): Promise<void> {
  const envKey = providerApiEnvKeyByProvider[provider];
  const hadKey = Boolean(deps.readProviderApiKeys()[envKey]);
  const hadSubscription = supportsSubscription(provider) && deps.readOAuthTokens(provider) !== undefined;
  if (method === "key") {
    if (!hadKey) {
      deps.printDim(t("cli.auth.logout.key_none", { provider }));
      return;
    }
    await deps.removeProviderApiKey(envKey);
    deps.printDim(t("cli.auth.logout.key", { provider }));
    return;
  }
  if (method === "subscription") {
    if (!hadSubscription || !supportsSubscription(provider)) {
      deps.printDim(t("cli.auth.logout.subscription_none", { provider }));
      return;
    }
    await deps.removeOAuthTokens(provider);
    deps.printDim(t("cli.auth.logout.subscription", { provider }));
    return;
  }
  if (!hadKey && !hadSubscription) {
    deps.printDim(t("cli.auth.logout_none", { provider }));
    return;
  }
  if (hadKey) await deps.removeProviderApiKey(envKey);
  if (hadSubscription && supportsSubscription(provider)) await deps.removeOAuthTokens(provider);
  deps.printDim(t("cli.auth.logout", { provider }));
}

async function resolveMethod(
  provider: Provider,
  parsed: ParsedAuthArgs,
  deps: AuthModeDeps,
): Promise<AuthMethod | null> {
  if (parsed.subscription) {
    if (!supportsSubscription(provider)) {
      deps.printError(t("cli.auth.subscription.unsupported", { provider }));
      process.exitCode = 1;
      return null;
    }
    return "subscription";
  }
  if (parsed.key || !supportsSubscription(provider)) return "key";
  if (!deps.interactive) {
    deps.printError(t("cli.auth.method.required"));
    process.exitCode = 1;
    return null;
  }

  return (await selectMethod(deps)) ?? null;
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
  if (parsed.key && parsed.subscription) {
    deps.printError(t("cli.auth.method.conflict"));
    process.exitCode = 1;
    return;
  }

  if (parsed.provider === undefined && (parsed.logout || parsed.key || parsed.subscription)) {
    deps.commandError("auth", t("cli.auth.provider.required"));
    process.exitCode = 1;
    return;
  }

  if (parsed.provider !== undefined) {
    const provider = parseProvider(parsed.provider);
    if (!provider) {
      deps.printError(t("cli.auth.invalid_provider", { providers: PROVIDER_LIST }));
      process.exitCode = 1;
      return;
    }
    await authenticateProvider(provider, parsed, deps);
    return;
  }

  if (!deps.interactive) {
    printStatus(deps);
    return;
  }

  const chosen = await selectProvider(deps);
  if (chosen) await authenticateProvider(chosen, parsed, deps);
}

async function authenticateProvider(provider: Provider, parsed: ParsedAuthArgs, deps: AuthModeDeps): Promise<void> {
  if (parsed.logout) {
    if (parsed.subscription && !supportsSubscription(provider)) {
      deps.printError(t("cli.auth.subscription.unsupported", { provider }));
      process.exitCode = 1;
      return;
    }
    await logoutProvider(provider, parsed.key ? "key" : parsed.subscription ? "subscription" : undefined, deps);
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
