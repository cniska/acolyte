import { describe, expect, test } from "bun:test";
import { serveMode } from "./cli-serve";

type Printed = { lines: string[] };

function createServeDeps(overrides?: Partial<Parameters<typeof serveMode>[1]>): Parameters<typeof serveMode>[1] {
  const printed: Printed = { lines: [] };
  const base: Parameters<typeof serveMode>[1] = {
    apiKey: undefined,
    hasHelpFlag: () => false,
    port: 6767,
    printDim: (message) => {
      printed.lines.push(message);
    },
    requestLocalServerShutdown: async () => false,
    serverEntry: "src/server.ts",
    subcommandError: () => {},
    subcommandHelp: () => {},
    ensureLocalServer: async () => ({ port: 6767, pid: 1234, started: false }),
    localServerStatus: async () => ({ running: true, pid: 1234, port: 6767 }),
    stopLocalServer: async () => ({ stopped: false, pid: null }),
    stopAllLocalServers: async () => [],
  };
  const deps = { ...base, ...overrides };
  return Object.assign(deps, { __printed: printed }) as Parameters<typeof serveMode>[1];
}

function printedLines(deps: Parameters<typeof serveMode>[1]): string[] {
  return ((deps as Parameters<typeof serveMode>[1] & { __printed?: Printed }).__printed?.lines ?? []).slice();
}

describe("cli-serve", () => {
  test("start prints already running when server exists", async () => {
    const deps = createServeDeps();
    await serveMode(["start"], deps);
    expect(printedLines(deps)).toEqual(["Server already running on port 6767 (pid 1234)"]);
  });

  test("start prints started when daemon is freshly spawned", async () => {
    const deps = createServeDeps({
      ensureLocalServer: async () => ({ port: 6767, pid: 5678, started: true }),
    });
    await serveMode(["start"], deps);
    expect(printedLines(deps)).toEqual(["Started server on port 6767 (pid 5678)"]);
  });

  test("stop prints stopped for each daemon", async () => {
    const deps = createServeDeps({
      stopAllLocalServers: async () => [{ port: 6767, pid: 1234 }],
    });
    await serveMode(["stop"], deps);
    expect(printedLines(deps)).toEqual(["Stopped server on port 6767 (pid 1234)"]);
  });

  test("stop falls back to shutdown request when no managed daemons found", async () => {
    const deps = createServeDeps({
      stopAllLocalServers: async () => [],
      requestLocalServerShutdown: async () => true,
    });
    await serveMode(["stop"], deps);
    expect(printedLines(deps)).toEqual(["Stopped server on port 6767 (pid 0)"]);
  });

  test("stop prints no servers running when nothing to stop", async () => {
    const deps = createServeDeps({
      stopAllLocalServers: async () => [],
      requestLocalServerShutdown: async () => false,
    });
    await serveMode(["stop"], deps);
    expect(printedLines(deps)).toEqual(["No servers running"]);
  });

  test("restart stops then starts on configured port", async () => {
    let ensured = 0;
    const deps = createServeDeps({
      stopLocalServer: async () => ({ stopped: true, pid: 1234 }),
      ensureLocalServer: async () => {
        ensured += 1;
        return { port: 6767, pid: 5678, started: true };
      },
    });
    await serveMode(["restart"], deps);
    expect(ensured).toBe(1);
    expect(printedLines(deps)).toEqual([
      "Stopped server on port 6767 (pid 1234)",
      "Started server on port 6767 (pid 5678)",
    ]);
  });

  test("status prints running state", async () => {
    const deps = createServeDeps();
    await serveMode(["status"], deps);
    expect(printedLines(deps)).toEqual(["Server running on port 6767 (pid 1234)"]);
  });

  test("status prints not running when server is down", async () => {
    const deps = createServeDeps({
      localServerStatus: async () => ({ running: false, pid: null, port: 6767 }),
    });
    await serveMode(["status"], deps);
    expect(printedLines(deps)).toEqual(["No server running on port 6767"]);
  });
});
