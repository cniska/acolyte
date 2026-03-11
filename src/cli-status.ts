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
  hasJsonFlag: (args: string[]) => boolean;
  isServerConnectionFailure: (error: unknown) => boolean;
  localServerStatus: typeof localServerStatusType;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  serverApiKey: typeof appConfigType.server.apiKey;
  serverPort: typeof appConfigType.server.port;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
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
    hasJsonFlag,
    isServerConnectionFailure,
    localServerStatus,
    printDim,
    printError,
    serverApiKey,
    serverPort,
    commandError,
    commandHelp,
  } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("status");
    return;
  }
  const json = hasJsonFlag(args);
  const nonFlagArgs = args.filter((a) => a !== "--json");
  if (nonFlagArgs.length > 0) {
    commandError("status");
    return;
  }
  const apiUrl = apiUrlForPort(serverPort);
  const client = createClient({ apiUrl });
  try {
    const status = await client.status();
    if (json) {
      printDim(`${JSON.stringify(status)}\n`);
    } else {
      printDim(formatStatusOutput(status));
    }
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
