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
    resolveLocalDaemonApiUrl: () => "http://127.0.0.1:6767",
    serverApiUrl: undefined,
    serverEntry: "src/server.ts",
    subcommandError: () => {},
    subcommandHelp: () => {},
    ensureLocalServer: async () => ({ apiUrl: "http://127.0.0.1:6767", started: false, managed: true }),
    formatLocalServerReadyMessage: () => "Using local server at http://127.0.0.1:6767",
    localServerStatus: async () => ({
      running: true,
      pid: null,
      apiUrl: "http://127.0.0.1:6767",
      managed: false,
    }),
    stopLocalServer: async () => false,
  };
  const deps = { ...base, ...overrides };
  return Object.assign(deps, { __printed: printed }) as Parameters<typeof serveMode>[1];
}

function printedLines(deps: Parameters<typeof serveMode>[1]): string[] {
  return ((deps as Parameters<typeof serveMode>[1] & { __printed?: Printed }).__printed?.lines ?? []).slice();
}

describe("cli-serve", () => {
  test("stop adopts unmanaged local server and shuts it down", async () => {
    const deps = createServeDeps({
      requestLocalServerShutdown: async () => true,
    });
    await serveMode(["stop"], deps);
    expect(printedLines(deps)).toEqual(["Stopped local server."]);
  });

  test("restart adopts unmanaged local server before starting managed daemon", async () => {
    let ensured = 0;
    const deps = createServeDeps({
      requestLocalServerShutdown: async () => true,
      ensureLocalServer: async () => {
        ensured += 1;
        return { apiUrl: "http://127.0.0.1:6767", started: true, managed: true };
      },
      formatLocalServerReadyMessage: (result) =>
        result.started ? "Started local server at http://127.0.0.1:6767" : "Using local server",
    });
    await serveMode(["restart"], deps);
    expect(ensured).toBe(1);
    expect(printedLines(deps)).toEqual(["Started local server at http://127.0.0.1:6767"]);
  });

  test("stop reports manual action only when unmanaged shutdown fails", async () => {
    const deps = createServeDeps({
      requestLocalServerShutdown: async () => false,
    });
    await serveMode(["stop"], deps);
    expect(printedLines(deps)).toEqual(["Unable to stop local server at http://127.0.0.1:6767. Stop it manually."]);
  });
});
