import type { requestLocalServerShutdown } from "./cli-server";
import { t } from "./i18n";
import type {
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";

type DaemonModeDeps = {
  apiKey?: string;
  hasHelpFlag: (args: string[]) => boolean;
  port: number;
  printDim: (message: string) => void;
  serverEntry: string;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  ensureLocalServer: typeof ensureLocalServer;
  listRunningDaemons: typeof listRunningDaemons;
  localServerStatus: typeof localServerStatus;
  requestLocalServerShutdown: typeof requestLocalServerShutdown;
  stopLocalServer: typeof stopLocalServer;
  stopAllLocalServers: typeof stopAllLocalServers;
};

export async function startMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("start");
    return;
  }
  if (args.length > 0) return deps.commandError("start");
  const result = await deps.ensureLocalServer({ port: deps.port, apiKey: deps.apiKey, serverEntry: deps.serverEntry });
  if (result.started) deps.printDim(t("cli.server.started", { port: deps.port, pid: result.pid }));
  else deps.printDim(t("cli.server.already_running", { port: deps.port, pid: result.pid }));
}

export async function stopMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("stop");
    return;
  }
  if (args.length > 0) return deps.commandError("stop");
  const stopped = await deps.stopAllLocalServers({ apiKey: deps.apiKey });
  if (stopped.length === 0) {
    const shutdown = await deps.requestLocalServerShutdown({ port: deps.port, apiKey: deps.apiKey });
    if (shutdown) {
      deps.printDim(t("cli.server.stopped", { port: deps.port, pid: 0 }));
      return;
    }
    deps.printDim(t("cli.server.no_servers_running"));
    return;
  }
  for (const entry of stopped) {
    deps.printDim(t("cli.server.stopped", { port: entry.port, pid: entry.pid }));
  }
}

export async function restartMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("restart");
    return;
  }
  if (args.length > 0) return deps.commandError("restart");
  const stopResult = await deps.stopLocalServer({ port: deps.port, apiKey: deps.apiKey });
  if (!stopResult.stopped) {
    const shutdown = await deps.requestLocalServerShutdown({ port: deps.port, apiKey: deps.apiKey });
    if (!shutdown) {
      const status = await deps.localServerStatus({ port: deps.port, apiKey: deps.apiKey });
      if (status.running) {
        deps.printDim(t("cli.server.stop_manual", { port: deps.port }));
        return;
      }
    }
  }
  const result = await deps.ensureLocalServer({ port: deps.port, apiKey: deps.apiKey, serverEntry: deps.serverEntry });
  deps.printDim(t("cli.server.restarted", { port: deps.port, pid: result.pid }));
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export async function psMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("ps");
    return;
  }
  if (args.length > 0) return deps.commandError("ps");
  const daemons = await deps.listRunningDaemons();
  if (daemons.length === 0) {
    deps.printDim(t("cli.server.no_servers_running"));
    return;
  }
  deps.printDim("PORT   PID      UPTIME");
  for (const d of daemons) {
    deps.printDim(`${String(d.port).padEnd(7)}${String(d.pid).padEnd(9)}${formatUptime(d.startedAt)}`);
  }
}
