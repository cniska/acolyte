import type {
  formatLocalServerReadyMessage as formatLocalServerReadyMessageType,
  requestLocalServerShutdown as requestLocalServerShutdownType,
  resolveLocalDaemonApiUrl as resolveLocalDaemonApiUrlType,
} from "./cli-server";
import { t } from "./i18n";
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
  requestLocalServerShutdown: typeof requestLocalServerShutdownType;
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
    requestLocalServerShutdown,
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
        printDim(t("cli.serve.local_not_running"));
        return;
      }
      if (status.pid) printDim(t("cli.serve.running_pid", { pid: status.pid, apiUrl: status.apiUrl ?? localApiUrl }));
      else printDim(t("cli.serve.running_external", { apiUrl: status.apiUrl ?? localApiUrl }));
      return;
    }
    case "stop": {
      if (args.length > 1) return subcommandError("server");
      const stopped = await stopLocalServer({ apiKey });
      if (stopped) {
        printDim(t("cli.serve.stopped"));
        return;
      }
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const status = await localServerStatus({ apiKey, apiUrl: localApiUrl });
      if (status.running && !status.pid) {
        const shutdown = await requestLocalServerShutdown({ apiUrl: localApiUrl, apiKey });
        if (shutdown) {
          printDim(t("cli.serve.stopped"));
          return;
        }
        printDim(t("cli.serve.stop_manual", { apiUrl: status.apiUrl ?? localApiUrl }));
        return;
      }
      printDim(t("cli.serve.local_not_running"));
      return;
    }
    case "restart": {
      if (args.length > 1) return subcommandError("server");
      const localApiUrl = resolveLocalDaemonApiUrl(serverApiUrl, port);
      const stopped = await stopLocalServer({ apiKey });
      if (!stopped) {
        const status = await localServerStatus({ apiKey, apiUrl: localApiUrl });
        if (status.running && !status.pid) {
          const shutdown = await requestLocalServerShutdown({ apiUrl: localApiUrl, apiKey });
          if (!shutdown) {
            printDim(t("cli.serve.stop_manual", { apiUrl: status.apiUrl ?? localApiUrl }));
            return;
          }
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
