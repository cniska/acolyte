import { type CallbackResult, DEFAULT_CLOUD_URL } from "./cli-callback-server";
import type { CloudMigrationSummary } from "./cloud-migrate";
import type { Credentials } from "./credentials";
import { errorMessage } from "./error-contract";
import { t } from "./i18n";

type LoginModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  parseFlag: (args: string[], flag: string) => string | undefined;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  promptHidden: (question: string) => Promise<string | undefined>;
  writeCredential: (key: keyof Credentials, value: string) => Promise<void>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  createId: () => string;
  startCallbackServer: (state: string) => Promise<{ port: number; result: Promise<CallbackResult> }>;
  openBrowser: (url: string) => void;
  migrateToCloud: (url: string, token: string) => Promise<CloudMigrationSummary>;
};

/**
 * Stores the credentials and copies what is already on this machine into the account. Signing in is
 * the first moment both the feature flag and a token exist, and every cloud write upserts on the
 * record id, so signing in again copies whatever a failed run left behind.
 */
async function completeLogin(deps: LoginModeDeps, url: string, token: string, confirmation: string): Promise<void> {
  await deps.writeCredential("cloudToken", token);
  await deps.writeCredential("cloudUrl", url);
  deps.printDim(confirmation);

  deps.printDim(t("cli.login.migrate.start"));
  try {
    const summary = await deps.migrateToCloud(url, token);
    deps.printDim(t("cli.login.migrate.done", { memories: summary.memories, sessions: summary.sessions }));
    if (summary.failures > 0) {
      deps.printDim(t("cli.login.migrate.failures", { failures: summary.failures }));
    }
  } catch (error) {
    // The credentials are already stored, so the sign-in held: only the copy needs another run.
    deps.printError(errorMessage(error));
  }
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
    // OAuth flow
    const state = deps.createId();
    const { port, result } = await deps.startCallbackServer(state);
    const authUrl = `${url}/auth/cli?port=${port}&state=${state}`;

    deps.printDim(t("cli.login.opening.browser"));
    deps.openBrowser(authUrl);
    deps.printDim(t("cli.login.waiting"));

    try {
      const { token, email } = await result;
      await completeLogin(deps, url, token, t("cli.login.welcome", { email }));
    } catch {
      deps.printError(t("cli.login.timeout"));
      process.exitCode = 1;
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
  removeCredential: (key: keyof Credentials) => Promise<void>;
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

  await deps.removeCredential("cloudToken");
  await deps.removeCredential("cloudUrl");
  deps.printDim(t("cli.logout.done"));
}
