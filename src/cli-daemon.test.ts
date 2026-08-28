import { describe, expect, test } from "bun:test";
import { psMode, restartMode, startMode, stopMode } from "./cli-daemon";
import { dedent } from "./test-utils";

type DaemonDeps = Parameters<typeof startMode>[1];

function createDeps(overrides?: Partial<DaemonDeps>): {
  deps: DaemonDeps;
  output: () => string;
  failures: () => number;
} {
  const lines: string[] = [];
  let failures = 0;
  const deps: DaemonDeps = {
    apiKey: undefined,
    hasHelpFlag: () => false,
    port: 6767,
    printDim: (message) => lines.push(message),
    failCommand: () => {
      failures += 1;
    },
    spawnCommand: [process.execPath, "run", "src/server.ts"],
    commandError: () => {},
    commandHelp: () => {},
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    listRunningDaemons: async () => [],
    localServerStatus: async () => ({ running: true, pid: 1234, port: 6767 }),
    stopLocalServer: async () => ({ kind: "not_running" }),
    stopAllLocalServers: async () => [],
    ...overrides,
  };
  return { deps, output: () => lines.join("\n"), failures: () => failures };
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
      stopAllLocalServers: async () => [{ port: 6767, result: { kind: "stopped", pid: 1234 } }],
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Stopped server on port 6767 (pid 1234)
      `),
    );
  });

  test("stop falls back to the configured port when no daemon holds a lock", async () => {
    const { deps, output } = createDeps({
      stopAllLocalServers: async () => [],
      stopLocalServer: async () => ({ kind: "stopped", pid: null }),
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Stopped server on port 6767 (pid 0)
      `),
    );
  });

  test("stop prints no servers running when nothing to stop", async () => {
    const { deps, output } = createDeps();
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        No servers running
      `),
    );
  });

  test("stop refuses while a turn is live and names the task and session", async () => {
    const { deps, output, failures } = createDeps({
      stopAllLocalServers: async () => [
        { port: 6767, result: { kind: "refused", tasks: [{ taskId: "task_abc", sessionId: "sess_xyz" }] } },
      ],
    });
    await stopMode([], deps);
    expect(output()).toContain("task_abc (sess_xyz)");
    expect(output()).toContain("--force");
    // A caller chaining on exit status must not read a refusal as a stop.
    expect(failures()).toBe(1);
  });

  // Regression: a daemon that would not die was dropped from the result, so a stop that left it
  // running printed only its successes and exited zero.
  test("stop reports a daemon it could not stop alongside one it did", async () => {
    const { deps, output, failures } = createDeps({
      stopAllLocalServers: async () => [
        { port: 4870, result: { kind: "unresponsive" } },
        { port: 6767, result: { kind: "stopped", pid: 1234 } },
      ],
    });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Unable to stop server on port 4870. Stop it manually.
        Stopped server on port 6767 (pid 1234)
      `),
    );
    expect(failures()).toBe(1);
  });

  test("stop --force passes force through and reports the stop", async () => {
    const forced: boolean[] = [];
    const { deps, output } = createDeps({
      stopAllLocalServers: async (input) => {
        forced.push(input?.force ?? false);
        return [{ port: 6767, result: { kind: "stopped", pid: 1234 } }];
      },
    });
    await stopMode(["--force"], deps);
    expect(forced).toEqual([true]);
    expect(output()).toBe(
      dedent(`
        Stopped server on port 6767 (pid 1234)
      `),
    );
  });

  test("stop rejects an unknown argument", async () => {
    let errored = "";
    const { deps } = createDeps({ commandError: (name) => (errored = name) });
    await stopMode(["--nope"], deps);
    expect(errored).toBe("stop");
  });

  test("stop tells the user to intervene when the daemon will not go down", async () => {
    const { deps, output } = createDeps({ stopLocalServer: async () => ({ kind: "unresponsive" }) });
    await stopMode([], deps);
    expect(output()).toBe(
      dedent(`
        Unable to stop server on port 6767. Stop it manually.
      `),
    );
  });

  test("restart does not start a replacement when the daemon will not go down", async () => {
    let ensured = 0;
    const { deps } = createDeps({
      stopLocalServer: async () => ({ kind: "unresponsive" }),
      ensureLocalServer: async () => {
        ensured += 1;
        return { port: 6767, pid: 5678, started: true };
      },
    });
    await restartMode([], deps);
    expect(ensured).toBe(0);
  });

  test("restart does not start a replacement when the stop is refused", async () => {
    let ensured = 0;
    const { deps, output } = createDeps({
      stopLocalServer: async () => ({ kind: "refused", tasks: [{ taskId: "task_abc", sessionId: null }] }),
      ensureLocalServer: async () => {
        ensured += 1;
        return { port: 6767, pid: 5678, started: true };
      },
    });
    await restartMode([], deps);
    expect(ensured).toBe(0);
    expect(output()).toContain("task_abc");
  });

  test("restart stops then starts on configured port", async () => {
    let ensured = 0;
    const { deps, output } = createDeps({
      stopLocalServer: async () => ({ kind: "stopped", pid: 1234 }),
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
        Port  PID   Uptime
        6767  1234  1h
      `),
    );
  });

  test("ps --json outputs JSON lines", async () => {
    const { deps, output } = createDeps({
      listRunningDaemons: async () => [
        { port: 6767, pid: 1234, startedAt: new Date(Date.now() - 3600_000).toISOString() },
      ],
    });
    await psMode(["--json"], deps);
    const parsed = JSON.parse(output()) as Record<string, string>;
    expect(parsed.port).toBe("6767");
    expect(parsed.pid).toBe("1234");
    expect(parsed.uptime).toBe("1h");
  });
});
