import { describe, expect, test } from "bun:test";
import { traceMode } from "./cli-trace";

type TraceDeps = Parameters<typeof traceMode>[1];

function createDeps(overrides?: Partial<TraceDeps>): { deps: TraceDeps; output: () => string } {
  const lines: string[] = [];
  const deps: TraceDeps = {
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

describe("traceMode", () => {
  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: (name) => {
        expect(name).toBe("trace");
        called = true;
      },
    });
    await traceMode([], deps);
    expect(called).toBe(true);
  });

  test("unknown subcommand calls commandError", async () => {
    let errorMsg = "";
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        errorMsg = msg ?? "";
      },
    });
    await traceMode(["bogus"], deps);
    expect(errorMsg).toContain("Unknown subcommand");
  });

  test("task subcommand without id calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        called = true;
        expect(msg).toContain("Missing task ID");
      },
    });
    await traceMode(["task"], deps);
    expect(called).toBe(true);
  });

  test("request subcommand without id calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        called = true;
        expect(msg).toContain("Missing request ID");
      },
    });
    await traceMode(["request"], deps);
    expect(called).toBe(true);
  });

  test("missing log file prints error", async () => {
    const { deps, output } = createDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    await traceMode([], deps);
    expect(output()).toContain("Cannot read log file");
  });

  test("task subcommand filters by exact id", async () => {
    const logContent = [
      "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_1 mode=work model=m",
      "2026-01-01T00:00:01Z event=lifecycle.start task_id=task_12 mode=work model=m",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["task", "task_1"], deps);
    expect(output()).toContain("task_id=task_1");
    expect(output()).not.toContain("task_id=task_12");
  });

  test("--task flag filters by id", async () => {
    const logContent = "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_1 mode=work model=m";
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["--task", "task_1"], deps);
    expect(output()).toContain("task_id=task_1");
  });

  test("request subcommand filters lines", async () => {
    const logContent = [
      "2026-01-01T00:00:00Z request_id=req_abc task_id=task_1 msg=hello",
      "2026-01-01T00:00:01Z request_id=req_other task_id=task_2 msg=world",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["request", "req_abc"], deps);
    expect(output()).toContain("request_id=req_abc");
    expect(output()).not.toContain("req_other");
  });

  test("default lists recent tasks", async () => {
    const logContent = [
      "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_a mode=work model=gpt-5-mini",
      "2026-01-01T00:00:01Z event=lifecycle.start task_id=task_b mode=work model=gpt-5-mini",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode([], deps);
    expect(output()).toContain("task_b");
    expect(output()).toContain("task_a");
  });

  test("--lines flag controls list count", async () => {
    const logContent = Array.from(
      { length: 100 },
      (_, i) => `ts${i} task_id=task_${i} event=lifecycle.start model=m`,
    ).join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["--lines", "5"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(6);
  });

  test("--json outputs JSON lines for task subcommand", async () => {
    const logContent = [
      "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_1 mode=work model=gpt-5-mini",
      "2026-01-01T00:00:01Z event=lifecycle.tool.call task_id=task_1 tool=read-file path=src/cli.ts",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]) as Record<string, string>;
    expect(first.timestamp).toBe("2026-01-01T00:00:00Z");
    expect(first.event).toBe("lifecycle.start");
    expect(first.task_id).toBe("task_1");
  });

  test("--json omits header lines", async () => {
    const logContent = "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_1 mode=work model=m";
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["--task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
