import { type CallbackHandoff, DEFAULT_CLOUD_URL } from "./cli-callback-server";
import type { CloudTokens } from "./cloud-auth-code";
import { type CloudMigrationSummary, isCredentialRejection } from "./cloud-migrate";
import { isSecureUrl } from "./config-contract";
import { type Credentials, decodeTokenSubject } from "./credentials";
import { errorCode, errorMessage, LOGIN_ERROR_CODES } from "./error-contract";
import { t } from "./i18n";
import type { PkceCodes } from "./pkce";
import { type UserResourceId, userResourceIdForSubject } from "./resource-id";
import type { UserScopeMergeSummary } from "./user-scope-merge";

type LoginModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  parseFlag: (args: string[], flag: string) => string | undefined;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  promptHidden: (question: string) => Promise<string | undefined>;
  writeCredential: (key: keyof Credentials, value: string) => Promise<void>;
  removeCredential: (key: keyof Credentials) => Promise<void>;
  checkCloudCredential: (url: string, token: string) => Promise<void>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  createState: () => string;
  createPkce: () => PkceCodes;
  exchangeAuthCode: (baseUrl: string, code: string, verifier: string) => Promise<CloudTokens>;
  startCallbackServer: (state: string) => Promise<CallbackHandoff>;
  openBrowser: (url: string) => void;
  migrateToCloud: (url: string, token: string, accountKey: UserResourceId) => Promise<CloudMigrationSummary>;
  mergeUserScope: (url: string, token: string, accountKey: UserResourceId) => Promise<UserScopeMergeSummary>;
};

function reportCopy(deps: LoginModeDeps, summary: CloudMigrationSummary): void {
  deps.printDim(t("cli.login.migrate.done", { memories: summary.memories, sessions: summary.sessions }));
  if (summary.failures > 0) deps.printDim(t("cli.login.migrate.failures", { failures: summary.failures }));
  if (summary.embeddingFailures > 0) {
    deps.printDim(t("cli.login.migrate.novectors", { embeddingFailures: summary.embeddingFailures }));
  }
}

function reportMerge(deps: LoginModeDeps, merge: UserScopeMergeSummary): void {
  deps.printDim(t("cli.login.merge.done", { merged: merge.merged }));
  if (merge.duplicates > 0) deps.printDim(t("cli.login.merge.duplicates", { duplicates: merge.duplicates }));
  if (merge.failures > 0) deps.printDim(t("cli.login.merge.failures", { failures: merge.failures }));
  if (merge.embeddingFailures > 0) {
    deps.printDim(t("cli.login.merge.novectors", { embeddingFailures: merge.embeddingFailures }));
  }
}

/**
 * Stores the credentials once the cloud accepts them, copies what is already on this machine into the
 * account, and moves what the machine remembered while signed out into it. Signing in is the first
 * moment both the feature flag
 * and a token exist, and every cloud write upserts on the record id, so signing in again finishes
 * whatever a failed run left behind.
 */
async function completeLogin(
  deps: LoginModeDeps,
  url: string,
  token: string,
  confirmation: string,
  refreshToken?: string,
): Promise<void> {
  if (!isSecureUrl(url)) {
    deps.printError(t("cli.login.url.insecure"));
    process.exitCode = 1;
    return;
  }

  // The user scope is the account the token names, so a token naming none cannot be signed in with.
  const subject = decodeTokenSubject(token);
  if (!subject) {
    deps.printError(t("cli.login.token.anonymous"));
    process.exitCode = 1;
    return;
  }
  const accountKey = userResourceIdForSubject(subject);

  // The stored token decides which account every later write lands in, so a token the cloud refuses
  // must not become one: it would key this machine's memory to an account that does not exist.
  try {
    await deps.checkCloudCredential(url, token);
  } catch (error) {
    deps.printError(
      isCredentialRejection(error)
        ? t("cli.login.token.rejected")
        : t("cli.login.token.unreachable", { reason: errorMessage(error) }),
    );
    process.exitCode = 1;
    return;
  }

  await deps.writeCredential("cloudToken", token);
  await deps.writeCredential("cloudUrl", url);

  // A token pasted by hand comes with no way to renew it. Dropping any stored refresh token keeps
  // this machine from renewing the new sign-in with the previous account's credential.
  if (refreshToken) await deps.writeCredential("cloudRefreshToken", refreshToken);
  else await deps.removeCredential("cloudRefreshToken");

  deps.printDim(confirmation);

  deps.printDim(t("cli.login.migrate.start"));
  try {
    reportCopy(deps, await deps.migrateToCloud(url, token, accountKey));
    reportMerge(deps, await deps.mergeUserScope(url, token, accountKey));
  } catch (error) {
    deps.printError(
      isCredentialRejection(error)
        ? t("cli.login.migrate.rejected")
        : t("cli.login.migrate.failed", { reason: errorMessage(error) }),
    );
    process.exitCode = 1;
  }
}

/**
 * Only a wait that ran out is a timeout. Every other way the handoff ends says what happened, so a
 * sign-in the browser completed is never reported as one the user never finished.
 */
function reportHandoffFailure(deps: LoginModeDeps, error: unknown): void {
  const code = errorCode(error);
  if (code === LOGIN_ERROR_CODES.codeMissing) deps.printError(t("cli.login.no_code"));
  else if (code === LOGIN_ERROR_CODES.exchangeUnsupported) deps.printError(t("cli.login.no_exchange"));
  else if (code === LOGIN_ERROR_CODES.exchangeRefused) deps.printError(t("cli.login.exchange_refused"));
  else if (code === LOGIN_ERROR_CODES.callbackTimeout) deps.printError(t("cli.login.timeout"));
  else deps.printError(t("cli.login.failed", { reason: errorMessage(error) }));
  process.exitCode = 1;
}

export async function loginMode(args: string[], deps: LoginModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("login");
    return;
  }

  const flagToken = deps.parseFlag(args, "--token");
  const flagUrl = deps.parseFlag(args, "--url");

  // Full bypass with flags
  if (flagToken && flagUrl) {
    await completeLogin(deps, flagUrl, flagToken, t("cli.login.saved"));
    return;
  }

  // Prompt for URL with default
  const urlInput = flagUrl ?? deps.prompt(t("cli.login.prompt.url"))?.trim();
  const url = urlInput || DEFAULT_CLOUD_URL;

  if (url === DEFAULT_CLOUD_URL) {
    // The browser carries back a code, and only the hash of the verifier goes with it. The verifier
    // itself travels to the cloud in the exchange, never through the browser, so a code read out of
    // browser history cannot be spent.
    const { verifier, challenge } = deps.createPkce();
    const state = deps.createState();
    const { port, result, stop } = await deps.startCallbackServer(state);
    const authUrl = `${url}/auth/cli?port=${port}&state=${state}&challenge=${encodeURIComponent(challenge)}`;

    deps.printDim(t("cli.login.opening.browser"));
    // The URL goes out before the opener runs: on a machine with no browser to open — a server over
    // SSH — this line is the whole sign-in, and it has to be there whether or not the opener works.
    deps.printDim(t("cli.login.open.manually", { url: authUrl }));

    try {
      deps.openBrowser(authUrl);
      deps.printDim(t("cli.login.waiting"));
      const { code } = await result;
      const tokens = await deps.exchangeAuthCode(url, code, verifier);
      await completeLogin(deps, url, tokens.token, t("cli.login.welcome", { email: tokens.email }), tokens.refresh);
    } catch (error) {
      stop();
      reportHandoffFailure(deps, error);
    }
  } else {
    // Manual token flow for custom URLs
    const token = flagToken ?? (await deps.promptHidden(t("cli.login.prompt.token")));
    if (!token) {
      deps.printError(t("cli.login.token.empty"));
      process.exitCode = 1;
      return;
    }

    await completeLogin(deps, url, token, t("cli.login.saved"));
  }
}

type LogoutModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  removeCredentials: (keys: (keyof Credentials)[]) => Promise<void>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export async function logoutMode(args: string[], deps: LogoutModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("logout");
    return;
  }
  if (args.length > 0) {
    deps.commandError("logout");
    return;
  }

  await deps.removeCredentials(["cloudToken", "cloudRefreshToken", "cloudUrl"]);
  deps.printDim(t("cli.logout.done"));
}
