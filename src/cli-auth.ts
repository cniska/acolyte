import { CodedError } from "./coded-error";
import { errorMessage } from "./error-contract";
import { t } from "./i18n";
import type { OAuthProvider, OAuthTokenSet } from "./oauth-store-contract";
import { buildAuthorizeUrl, createPkce } from "./openai-oauth";
import type { OAuthCallbackServer, OAuthServerErrorKind } from "./openai-oauth-server";

type AuthModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  openBrowser: (url: string) => void;
  createState: () => string;
  startCallbackServer: (state: string) => OAuthCallbackServer;
  exchangeCode: (input: { code: string; verifier: string }) => Promise<OAuthTokenSet>;
  writeOAuthTokens: (provider: OAuthProvider, tokens: OAuthTokenSet) => Promise<void>;
  removeOAuthTokens: (provider: OAuthProvider) => Promise<void>;
  readOAuthTokens: (provider: OAuthProvider) => OAuthTokenSet | undefined;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

const SUPPORTED_PROVIDERS: OAuthProvider[] = ["openai"];

function isSupportedProvider(value: string): value is OAuthProvider {
  return (SUPPORTED_PROVIDERS as string[]).includes(value);
}

function authErrorMessage(error: unknown): string {
  const kind = error instanceof CodedError ? (error.kind as OAuthServerErrorKind | undefined) : undefined;
  if (kind === "port_in_use") return t("cli.auth.port_in_use");
  if (kind === "timeout") return t("cli.auth.timeout");
  return t("cli.auth.failed", { reason: errorMessage(error) });
}

async function loginOpenAI(deps: AuthModeDeps): Promise<void> {
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
    await deps.writeOAuthTokens("openai", tokens);
    deps.printDim(t("cli.auth.success"));
  } catch (error) {
    void server.stop();
    deps.printError(authErrorMessage(error));
    process.exitCode = 1;
  }
}

function printStatus(deps: AuthModeDeps): void {
  const connected = SUPPORTED_PROVIDERS.filter((provider) => deps.readOAuthTokens(provider) !== undefined);
  if (connected.length === 0) {
    deps.printDim(t("cli.auth.status.none"));
    return;
  }
  for (const provider of connected) deps.printDim(t("cli.auth.status.connected", { provider }));
}

export async function authMode(args: string[], deps: AuthModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("auth");
    return;
  }

  const provider = args[0];
  if (provider === undefined) {
    printStatus(deps);
    return;
  }

  if (!isSupportedProvider(provider)) {
    deps.commandError("auth", t("cli.auth.invalid_provider", { provider }));
    process.exitCode = 1;
    return;
  }

  if (args.includes("--logout")) {
    if (deps.readOAuthTokens(provider) === undefined) {
      deps.printDim(t("cli.auth.logout_none", { provider }));
      return;
    }
    await deps.removeOAuthTokens(provider);
    deps.printDim(t("cli.auth.logout", { provider }));
    return;
  }

  await loginOpenAI(deps);
}
