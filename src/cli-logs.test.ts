import { describe, expect, test } from "bun:test";
import { logsMode } from "./cli-logs";

type LogsDeps = Parameters<typeof logsMode>[1];

function createDeps(overrides?: Partial<LogsDeps>): { deps: LogsDeps; output: () => string } {
  const lines: string[] = [];
  const deps: LogsDeps = {
    hasHelpFlag: () => false,
    logPath: "/dev/null",
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(`ERROR: ${message}`),
    readFile: async () => "",
    commandError: () => {},
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

const SAMPLE_LOG = [
  '2026-03-20T10:00:00Z level=info msg="server started" session_id=sess_1',
  '2026-03-20T10:00:01Z level=debug msg="lifecycle start" task_id=task_1 session_id=sess_1',
  '2026-03-20T10:00:02Z level=warn msg="slow query" session_id=sess_2',
  '2026-03-20T10:00:03Z level=error msg="connection failed" session_id=sess_1',
  '2026-03-20T10:00:04Z level=info msg="task complete" task_id=task_1 session_id=sess_1',
].join("\n");

describe("logsMode", () => {
  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: (name) => {
        expect(name).toBe("logs");
        called = true;
      },
    });
    await logsMode([], deps);
    expect(called).toBe(true);
  });

  test("missing log file prints error", async () => {
    const { deps, output } = createDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    await logsMode([], deps);
    expect(output()).toContain("No log file");
  });

  test("empty log prints no lines message", async () => {
    const { deps, output } = createDeps();
    await logsMode([], deps);
    expect(output()).toContain("No log lines");
  });

  test("default shows last 40 lines", async () => {
    const manyLines = Array.from(
      { length: 60 },
      (_, i) => `2026-03-20T10:${String(i).padStart(2, "0")}:00Z level=info msg="line ${i}"`,
    ).join("\n");
    const { deps, output } = createDeps({ readFile: async () => manyLines });
    await logsMode([], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(40);
  });

  test("--lines controls tail count", async () => {
    const { deps, output } = createDeps({ readFile: async () => SAMPLE_LOG });
    await logsMode(["--lines", "2"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(2);
  });

  test("--level filters by level", async () => {
    const { deps, output } = createDeps({ readFile: async () => SAMPLE_LOG });
    await logsMode(["--level", "error"], deps);
    expect(output()).toContain("connection failed");
    expect(output()).not.toContain("server started");
  });

  test("--session filters by session_id", async () => {
    const { deps, output } = createDeps({ readFile: async () => SAMPLE_LOG });
    await logsMode(["--session", "sess_2"], deps);
    expect(output()).toContain("slow query");
    expect(output()).not.toContain("server started");
  });

  test("invalid level calls commandError", async () => {
    let errorMsg = "";
    const { deps } = createDeps({
      readFile: async () => SAMPLE_LOG,
      commandError: (_name, msg) => {
        errorMsg = msg ?? "";
      },
    });
    await logsMode(["--level", "bogus"], deps);
    expect(errorMsg).toContain("Invalid level");
  });

  test("invalid --since calls commandError", async () => {
    let errorMsg = "";
    const { deps } = createDeps({
      readFile: async () => SAMPLE_LOG,
      commandError: (_name, msg) => {
        errorMsg = msg ?? "";
      },
    });
    await logsMode(["--since", "abc"], deps);
    expect(errorMsg).toContain("Invalid --since");
  });

  test("--since filters by timestamp", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const old = "2020-01-01T00:00:00Z";
    const log = [`${old} level=info msg="ancient"`, `${recent} level=info msg="recent"`].join("\n");
    const { deps, output } = createDeps({ readFile: async () => log });
    await logsMode(["--since", "5m"], deps);
    expect(output()).toContain("recent");
    expect(output()).not.toContain("ancient");
  });

  test("--json outputs JSON lines", async () => {
    const { deps, output } = createDeps({ readFile: async () => SAMPLE_LOG });
    await logsMode(["--lines", "1", "--json"], deps);
    const parsed = JSON.parse(output()) as Record<string, string>;
    expect(parsed.msg).toBe("task complete");
  });

  test("filters combine correctly", async () => {
    const { deps, output } = createDeps({ readFile: async () => SAMPLE_LOG });
    await logsMode(["--level", "info", "--session", "sess_1"], deps);
    expect(output()).toContain("server started");
    expect(output()).toContain("task complete");
    expect(output()).not.toContain("slow query");
    expect(output()).not.toContain("connection failed");
  });
});
