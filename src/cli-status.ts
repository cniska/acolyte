import type { appConfig as appConfigType } from "./app-config";
import type { createClient as createClientType } from "./client-factory";
import { t } from "./i18n";
import type { apiUrlForPort as apiUrlForPortType, localServerStatus as localServerStatusType } from "./server-daemon";
import type { formatStatusOutput as formatStatusOutputType } from "./status-format";

type StatusModeDeps = {
  apiUrlForPort: typeof apiUrlForPortType;
  createClient: typeof createClientType;
  formatStatusOutput: typeof formatStatusOutputType;
  hasHelpFlag: (args: string[]) => boolean;
  isServerConnectionFailure: (error: unknown) => boolean;
  localServerStatus: typeof localServerStatusType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverPort: typeof appConfigType.server.port;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
};

export function isServerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Cannot reach server at ");
}

export async function statusMode(args: string[], deps: StatusModeDeps): Promise<void> {
  const {
    apiUrlForPort,
    createClient,
    formatStatusOutput,
    hasHelpFlag,
    isServerConnectionFailure,
    localServerStatus,
    printDim,
    printError,
    serverApiKey,
    serverPort,
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
  const apiUrl = apiUrlForPort(serverPort);
  const client = createClient({ apiUrl });
  try {
    const status = await client.status();
    printDim(formatStatusOutput(status));
  } catch (error) {
    if (isServerConnectionFailure(error)) {
      const localStatus = await localServerStatus({ port: serverPort, apiKey: serverApiKey });
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
