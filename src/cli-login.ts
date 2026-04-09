import type { CallbackResult } from "./cli-callback-server";
import type { Credentials } from "./credentials";
import { t } from "./i18n";

const DEFAULT_CLOUD_URL = "https://app.acolyte.sh";

type LoginModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  parseFlag: (args: string[], flag: string) => string | undefined;
  prompt: (question: string) => string | null;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  promptHidden: (question: string) => Promise<string | undefined>;
  writeCredential: (key: keyof Credentials, value: string, homeDir?: string) => Promise<void>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  createId: () => string;
  startCallbackServer: (state: string) => Promise<{ port: number; result: Promise<CallbackResult> }>;
  openBrowser: (url: string) => void;
};

export async function loginMode(args: string[], deps: LoginModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("login");
    return;
  }

  const flagToken = deps.parseFlag(args, "--token");
  const flagUrl = deps.parseFlag(args, "--url");

  // Full bypass with flags
  if (flagToken && flagUrl) {
    await deps.writeCredential("cloudToken", flagToken);
    await deps.writeCredential("cloudUrl", flagUrl);
    deps.printDim(t("cli.login.saved"));
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
      await deps.writeCredential("cloudToken", token);
      await deps.writeCredential("cloudUrl", url);
      deps.printDim(t("cli.login.welcome", { email }));
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

    await deps.writeCredential("cloudToken", token);
    await deps.writeCredential("cloudUrl", url);
    deps.printDim(t("cli.login.saved"));
  }
}

type LogoutModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  removeCredential: (key: keyof Credentials, homeDir?: string) => Promise<void>;
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
