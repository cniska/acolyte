import type { requestLocalServerShutdown as requestLocalServerShutdownType } from "./cli-server";
import { t } from "./i18n";
import type {
  ensureLocalServer as ensureLocalServerType,
  localServerStatus as localServerStatusType,
  stopAllLocalServers as stopAllLocalServersType,
  stopLocalServer as stopLocalServerType,
} from "./server-daemon";

type ServeModeDeps = {
  apiKey?: string;
  hasHelpFlag: (args: string[]) => boolean;
  port: number;
  printDim: (message: string) => void;
  requestLocalServerShutdown: typeof requestLocalServerShutdownType;
  serverEntry: string;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
  ensureLocalServer: typeof ensureLocalServerType;
  localServerStatus: typeof localServerStatusType;
  stopLocalServer: typeof stopLocalServerType;
  stopAllLocalServers: typeof stopAllLocalServersType;
};

export async function serveMode(args: string[], deps: ServeModeDeps): Promise<void> {
  const {
    apiKey,
    ensureLocalServer,
    hasHelpFlag,
    localServerStatus,
    port,
    printDim,
    requestLocalServerShutdown,
    serverEntry,
    stopAllLocalServers,
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
      const result = await ensureLocalServer({ port, apiKey, serverEntry });
      if (result.started) printDim(t("cli.server.started", { port, pid: result.pid }));
      else printDim(t("cli.server.already_running", { port, pid: result.pid }));
      return;
    }
    case "status": {
      if (args.length > 1) return subcommandError("server");
      const status = await localServerStatus({ port, apiKey });
      if (status.running) printDim(t("cli.server.running", { port, pid: status.pid ?? 0 }));
      else printDim(t("cli.server.not_running", { port }));
      return;
    }
    case "stop": {
      if (args.length > 1) return subcommandError("server");
      const stopped = await stopAllLocalServers({ apiKey });
      if (stopped.length === 0) {
        const shutdown = await requestLocalServerShutdown({ port, apiKey });
        if (shutdown) {
          printDim(t("cli.server.stopped", { port, pid: 0 }));
          return;
        }
        printDim(t("cli.server.no_servers_running"));
        return;
      }
      for (const entry of stopped) {
        printDim(t("cli.server.stopped", { port: entry.port, pid: entry.pid }));
      }
      return;
    }
    case "restart": {
      if (args.length > 1) return subcommandError("server");
      const stopResult = await stopLocalServer({ port, apiKey });
      if (stopResult.stopped) {
        printDim(t("cli.server.stopped", { port, pid: stopResult.pid ?? 0 }));
      } else {
        const shutdown = await requestLocalServerShutdown({ port, apiKey });
        if (!shutdown) {
          const status = await localServerStatus({ port, apiKey });
          if (status.running) {
            printDim(t("cli.server.stop_manual", { port }));
            return;
          }
        }
      }
      const result = await ensureLocalServer({ port, apiKey, serverEntry });
      printDim(t("cli.server.started", { port, pid: result.pid }));
      return;
    }
    default:
      subcommandError("server");
  }
}
