import { describe, expect, test } from "bun:test";
import { psMode, restartMode, startMode, stopMode } from "./cli-daemon";
import { dedent } from "./test-utils";

type DaemonDeps = Parameters<typeof startMode>[1];

function createDeps(overrides?: Partial<DaemonDeps>): { deps: DaemonDeps; output: () => string } {
  const lines: string[] = [];
  const deps: DaemonDeps = {
    apiKey: undefined,
    hasHelpFlag: () => false,
    port: 6767,
    printDim: (message) => lines.push(message),
    requestLocalServerShutdown: async () => false,
    serverEntry: "src/server.ts",
    commandError: () => {},
    commandHelp: () => {},
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    listRunningDaemons: async () => [],
    localServerStatus: async () => ({ running: true, pid: 1234, port: 6767 }),
    stopLocalServer: async () => ({ stopped: false, pid: null }),
    stopAllLocalServers: async () => [],
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

describe("cli-daemon", () => {
  test("start prints already running when server exists", async () => {
    const { deps, output } = createDeps();
    await startMode([], deps);
    expect(output()).toBe(
      dedent(`
        Server already running on port 6767 (pid 1234)
      `),
    );
  });

  test("start prints started when daemon is freshly spawned", async () => {
    const { deps, output } = createDeps({
      ensureLocalServer: async () => ({ port: 6767, pid: 5678, started: true }),
    });
    await startMode([], deps);
    expect(output()).toBe(
      dedent(`
        Started server on port 6767 (pid 5678)
      `),
    );
  });

  test("stop prints stopped for each daemon", async () => {
    const { deps, output } = createDeps({
      stopAllLocalServers: async () => [{ port: 6767, pid: 1234 }],
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Stopped server on port 6767 (pid 1234)
      `),
    );
  });

  test("stop falls back to shutdown request when no managed daemons found", async () => {
    const { deps, output } = createDeps({
      stopAllLocalServers: async () => [],
      requestLocalServerShutdown: async () => true,
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Stopped server on port 6767 (pid 0)
      `),
    );
  });

  test("stop prints no servers running when nothing to stop", async () => {
    const { deps, output } = createDeps({
      stopAllLocalServers: async () => [],
      requestLocalServerShutdown: async () => false,
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        No servers running
      `),
    );
  });

  test("restart stops then starts on configured port", async () => {
    let ensured = 0;
    const { deps, output } = createDeps({
      stopLocalServer: async () => ({ stopped: true, pid: 1234 }),
      ensureLocalServer: async () => {
        ensured += 1;
        return { port: 6767, pid: 5678, started: true };
      },
    });
    await restartMode([], deps);
    expect(ensured).toBe(1);
    expect(output()).toBe(
      dedent(`
        Restarted server on port 6767 (pid 5678)
      `),
    );
  });

  test("ps prints no servers running when empty", async () => {
    const { deps, output } = createDeps();
    await psMode([], deps);
    expect(output()).toBe(
      dedent(`
        No servers running
      `),
    );
  });

  test("ps prints table of running daemons", async () => {
    const { deps, output } = createDeps({
      listRunningDaemons: async () => [
        { port: 6767, pid: 1234, startedAt: new Date(Date.now() - 3600_000).toISOString() },
      ],
    });
    await psMode([], deps);
    expect(output()).toBe(
      dedent(`
        PORT   PID      UPTIME
        6767   1234     1h
      `),
    );
  });
});
