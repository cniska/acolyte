import type {
  formatLocalServerReadyMessage as formatLocalServerReadyMessageType,
  resolveLocalDaemonApiUrl as resolveLocalDaemonApiUrlType,
} from "./cli-server";
import type {
  ensureLocalServer as ensureLocalServerType,
  localServerStatus as localServerStatusType,
  stopLocalServer as stopLocalServerType,
} from "./server-daemon";

type ServeModeDeps = {
  apiKey?: string;
  hasHelpFlag: (args: string[]) => boolean;
  port: number;
  printDim: (message: string) => void;
  resolveLocalDaemonApiUrl: typeof resolveLocalDaemonApiUrlType;
  serverApiUrl?: string;
  serverEntry: string;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
  ensureLocalServer: typeof ensureLocalServerType;
  formatLocalServerReadyMessage: typeof formatLocalServerReadyMessageType;
  localServerStatus: typeof localServerStatusType;
  stopLocalServer: typeof stopLocalServerType;
};

export async function serveMode(args: string[], deps: ServeModeDeps): Promise<void> {
  const {
    apiKey,
    ensureLocalServer,
    formatLocalServerReadyMessage,
    hasHelpFlag,
    localServerStatus,
    port,
    printDim,
    resolveLocalDaemonApiUrl,
    serverApiUrl,
    serverEntry,
    stopLocalServer,
    subcommandError,
    subcommandHelp,
  } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("server");
    return;
  }
  const action = args[0] ?? "start";
  switch (action) {
    case "start": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const daemon = await ensureLocalServer({
        apiUrl: localApiUrl,
        port,
        apiKey,
        serverEntry,
      });
      printDim(formatLocalServerReadyMessage(daemon));
      return;
    }
    case "status": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const status = await localServerStatus({ apiKey, apiUrl: localApiUrl });
      if (!status.running) {
        printDim("Local server is not running.");
        return;
      }
      if (status.pid) printDim(`Local server running (pid ${status.pid}) at ${status.apiUrl}`);
      else printDim(`Local server running (external) at ${status.apiUrl}`);
      return;
    }
    case "stop": {
      if (args.length > 1) return subcommandError("server");
      const stopped = await stopLocalServer({ apiKey });
      if (stopped) {
        printDim("Stopped local server.");
        return;
      }
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const status = await localServerStatus({ apiKey, apiUrl: localApiUrl });
      if (status.running && !status.pid) {
        printDim(`Local server is running as an external process at ${status.apiUrl}. Stop it manually.`);
        return;
      }
      printDim("Local server is not running.");
      return;
    }
    case "restart": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const stopped = await stopLocalServer({ apiKey });
      if (!stopped) {
        const status = await localServerStatus({ apiKey, apiUrl: localApiUrl });
        if (status.running && !status.pid) {
          printDim(`Local server is running as an external process at ${status.apiUrl}. Stop it manually.`);
          return;
        }
      }
      const daemon = await ensureLocalServer({
        apiUrl: localApiUrl,
        port,
        apiKey,
        serverEntry,
      });
      printDim(formatLocalServerReadyMessage(daemon));
      return;
    }
    default:
      subcommandError("server");
  }
}
