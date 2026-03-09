import { describe, expect, test } from "bun:test";
import { isServerConnectionFailure, statusMode } from "./cli-status";

type StatusDeps = Parameters<typeof statusMode>[1];

function createStatusDeps(): {
  deps: StatusDeps;
  lines: { dim: string[]; err: string[]; help: string[]; subError: string[] };
} {
  const lines = { dim: [] as string[], err: [] as string[], help: [] as string[], subError: [] as string[] };
  const deps: StatusDeps = {
    apiUrlForPort: (port) => `http://127.0.0.1:${port}`,
    createClient: () =>
      ({
        status: async () => ({
          providers: ["openai"],
          model: "gpt-5-mini",
          permissions: "write",
          service: "http://127.0.0.1:6767",
          memory: "off",
        }),
      }) as never,
    formatStatusOutput: () => "status-ok",
    hasHelpFlag: (args) => args.includes("--help"),
    isServerConnectionFailure: () => false,
    localServerStatus: async () => ({ running: false, pid: null, port: 6767 }),
    printDim: (line) => lines.dim.push(line),
    printError: (line) => lines.err.push(line),
    serverApiKey: "key",
    serverPort: 6767,
    subcommandError: (name) => lines.subError.push(name),
    subcommandHelp: (name) => lines.help.push(name),
  };
  return { deps, lines };
}

describe("cli-status", () => {
  test("isServerConnectionFailure matches reachability errors only", () => {
    expect(isServerConnectionFailure(new Error("Cannot reach server at http://127.0.0.1:6767"))).toBe(true);
    expect(isServerConnectionFailure(new Error("Status check failed (401): unauthorized"))).toBe(false);
    expect(isServerConnectionFailure(new Error("boom"))).toBe(false);
    expect(isServerConnectionFailure("Cannot reach server")).toBe(false);
  });

  test("shows help for --help", async () => {
    const { deps, lines } = createStatusDeps();
    await statusMode(["--help"], deps);
    expect(lines.help).toEqual(["status"]);
  });

  test("prints local-start hint when connection fails and local server is down", async () => {
    const { deps, lines } = createStatusDeps();
    deps.createClient = () =>
      ({
        status: async () => {
          throw new Error("Cannot reach server at http://127.0.0.1:6767");
        },
      }) as never;
    deps.isServerConnectionFailure = (error) => error instanceof Error && error.message.includes("Cannot reach server");

    await statusMode([], deps);
    expect(lines.dim).toContain("Local server is not running. Start it with: acolyte server start");
  });
});
