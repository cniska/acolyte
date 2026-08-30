import { unreachable } from "./assert";
import { hasBoolFlag, stripFlag } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { t } from "./i18n";
import type {
  ensureLocalServer,
  listRunningDaemons,
  localServerStatus,
  StopResult,
  stopAllLocalServers,
  stopLocalServer,
} from "./server-daemon";
import type { LiveTask } from "./shutdown-contract";

type DaemonModeDeps = {
  apiKey?: string;
  hasHelpFlag: (args: string[]) => boolean;
  port: number;
  printDim: (message: string) => void;
  printOutput: (message: string) => void;
  failCommand: () => void;
  spawnCommand: string[];
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
  ensureLocalServer: typeof ensureLocalServer;
  listRunningDaemons: typeof listRunningDaemons;
  localServerStatus: typeof localServerStatus;
  stopLocalServer: typeof stopLocalServer;
  stopAllLocalServers: typeof stopAllLocalServers;
};

export async function startMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("start");
    return;
  }
  if (args.length > 0) return deps.commandError("start");
  const result = await deps.ensureLocalServer({
    port: deps.port,
    apiKey: deps.apiKey,
    spawnCommand: deps.spawnCommand,
  });
  if (result.started) deps.printDim(t("cli.server.started", { port: deps.port, pid: result.pid }));
  else deps.printDim(t("cli.server.already_running", { port: deps.port, pid: result.pid }));
}

function formatLiveTasks(tasks: LiveTask[]): string {
  return tasks.map((task) => (task.sessionId ? `${task.taskId} (${task.sessionId})` : task.taskId)).join(", ");
}

// A refused stop must not read as success to a caller chaining on exit status.
function printRefusal(deps: DaemonModeDeps, port: number, tasks: LiveTask[]): void {
  deps.printDim(t("cli.server.stop_refused", { port, tasks: formatLiveTasks(tasks) }));
  deps.failCommand();
}

function printStopResult(deps: DaemonModeDeps, port: number, result: StopResult): void {
  switch (result.kind) {
    case "stopped":
      deps.printDim(t("cli.server.stopped", { port, pid: result.pid ?? 0 }));
      return;
    case "refused":
      printRefusal(deps, port, result.tasks);
      return;
    case "unresponsive":
      deps.printDim(t("cli.server.stop_manual", { port }));
      deps.failCommand();
      return;
    case "not_running":
      deps.printDim(t("cli.server.no_servers_running"));
      return;
    default:
      unreachable(result);
  }
}

export async function stopMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("stop");
    return;
  }
  const force = hasBoolFlag(args, "--force");
  if (stripFlag(args, "--force").length > 0) return deps.commandError("stop");
  const results = await deps.stopAllLocalServers({ apiKey: deps.apiKey, force });
  const present = results.filter(({ result }) => result.kind !== "not_running");
  if (present.length === 0) {
    // No daemon holds a lock file, but one may still be listening on the configured port.
    printStopResult(deps, deps.port, await deps.stopLocalServer({ port: deps.port, apiKey: deps.apiKey, force }));
    return;
  }
  for (const { port, result } of present) {
    printStopResult(deps, port, result);
  }
}

export async function restartMode(args: string[], deps: DaemonModeDeps): Promise<void> {
  if (deps.hasHelpFlag(args)) {
    deps.commandHelp("restart");
    return;
  }
  const force = hasBoolFlag(args, "--force");
  if (stripFlag(args, "--force").length > 0) return deps.commandError("restart");
  const stopResult = await deps.stopLocalServer({ port: deps.port, apiKey: deps.apiKey, force });
  // Restarting over a live turn would abandon it as surely as stopping does.
  if (stopResult.kind === "refused") {
    printRefusal(deps, deps.port, stopResult.tasks);
    return;
  }
  if (stopResult.kind === "unresponsive") {
    deps.printDim(t("cli.server.stop_manual", { port: deps.port }));
    deps.failCommand();
    return;
  }
  if (stopResult.kind === "not_running") {
    const status = await deps.localServerStatus({ port: deps.port, apiKey: deps.apiKey });
    if (status.running) {
      deps.printDim(t("cli.server.stop_manual", { port: deps.port }));
      deps.failCommand();
      return;
    }
  }
  const result = await deps.ensureLocalServer({
    port: deps.port,
    apiKey: deps.apiKey,
    spawnCommand: deps.spawnCommand,
  });
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
  const json = hasBoolFlag(args, "--json");
  const rest = stripFlag(args, "--json");
  if (rest.length > 0) return deps.commandError("ps");
  const daemons = await deps.listRunningDaemons();
  if (daemons.length === 0) {
    deps.printDim(t("cli.server.no_servers_running"));
    return;
  }
  const out: CliOutput = json ? createJsonOutput() : createTextOutput();
  out.addTable(
    daemons.map((d) => ({
      port: String(d.port),
      pid: String(d.pid),
      uptime: formatUptime(d.startedAt),
    })),
    {
      port: t("cli.server.col.port"),
      pid: t("cli.server.col.pid"),
      uptime: t("cli.server.col.uptime"),
    },
  );
  const rendered = out.render();
  if (rendered) (json ? deps.printOutput : deps.printDim)(rendered);
}
