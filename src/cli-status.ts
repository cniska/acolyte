import type { appConfig as appConfigType } from "./app-config";
import type {
  resolveChatApiUrl as resolveChatApiUrlType,
  resolveLocalDaemonApiUrl as resolveLocalDaemonApiUrlType,
  shouldAutoStartLocalServerForChat as shouldAutoStartLocalServerForChatType,
} from "./cli-server";
import type { createClient as createClientType } from "./client";
import { t } from "./i18n";
import type { localServerStatus as localServerStatusType } from "./server-daemon";
import type { formatStatusOutput as formatStatusOutputType } from "./status-format";

type StatusModeDeps = {
  createClient: typeof createClientType;
  formatStatusOutput: typeof formatStatusOutputType;
  hasHelpFlag: (args: string[]) => boolean;
  isServerConnectionFailure: (error: unknown) => boolean;
  localServerStatus: typeof localServerStatusType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  resolveChatApiUrl: typeof resolveChatApiUrlType;
  resolveLocalDaemonApiUrl: typeof resolveLocalDaemonApiUrlType;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverApiUrl: typeof appConfigType.server.apiUrl;
  serverPort: typeof appConfigType.server.port;
  shouldAutoStartLocalServerForChat: typeof shouldAutoStartLocalServerForChatType;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
};

export function isServerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Cannot reach server at ");
}

export async function statusMode(args: string[], deps: StatusModeDeps): Promise<void> {
  const {
    createClient,
    formatStatusOutput,
    hasHelpFlag,
    isServerConnectionFailure,
    localServerStatus,
    printDim,
    printError,
    resolveChatApiUrl,
    resolveLocalDaemonApiUrl,
    serverApiKey,
    serverApiUrl,
    serverPort,
    shouldAutoStartLocalServerForChat,
    subcommandError,
    subcommandHelp,
  } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("status");
    return;
  }
  if (args.length > 0) {
    subcommandError("status");
    return;
  }
  const apiUrl = resolveChatApiUrl(serverApiUrl, serverPort);
  const client = createClient({
    apiUrl,
  });
  try {
    const status = await client.status();
    printDim(formatStatusOutput(status));
  } catch (error) {
    if (shouldAutoStartLocalServerForChat(serverApiUrl) && isServerConnectionFailure(error)) {
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, serverPort);
      const localStatus = await localServerStatus({ apiKey: serverApiKey, apiUrl: localApiUrl });
      if (!localStatus.running) {
        printDim(t("cli.status.local_start_hint"));
        return;
      }
    }
    const message = error instanceof Error ? error.message : t("unknown_error");
    printError(message);
    process.exitCode = 1;
  }
}
