import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { traceMode } from "./cli-trace";
import { tempDir } from "./test-utils";
import { createTraceStore, type TraceStore } from "./trace-store";

type TraceDeps = Parameters<typeof traceMode>[1];
const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

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

  test("task subcommand without id traces latest task", async () => {
    const log = [
      '2026-01-01T00:00:00.000Z level=info msg="agent debug" task_id=task_latest event=lifecycle.start mode=work model=gpt-5',
    ].join("\n");
    const { deps, output } = createDeps({ readFile: async () => log });
    await traceMode(["task"], deps);
    expect(output()).toContain("task_latest");
  });

  test("task subcommand without id and empty log prints no tasks", async () => {
    const { deps, output } = createDeps();
    await traceMode(["task"], deps);
    expect(output()).toContain("No tasks");
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
    await traceMode(["task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});

function createTestTraceStore(): { store: TraceStore; cleanup: () => void } {
  const dir = createDir("acolyte-trace-cli-");
  const store = createTraceStore(join(dir, "trace.db"));
  return { store, cleanup: () => store.close() };
}

describe("traceMode with SQLite", () => {
  test("list uses trace store when available", async () => {
    const { store } = createTestTraceStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_sql_a",
      event: "lifecycle.start",
      fields: { model: "gpt-5-mini", mode: "work" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode([], deps);
    expect(output()).toContain("task_sql_a");
  });

  test("task subcommand queries store by task id", async () => {
    const { store } = createTestTraceStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_sql_1",
      event: "lifecycle.start",
      fields: { model: "gpt-5", mode: "work" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_sql_1",
      event: "lifecycle.tool.call",
      fields: { tool: "read-file" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_sql_1"], deps);
    expect(output()).toContain("lifecycle.start");
    expect(output()).toContain("lifecycle.tool.call");
  });

  test("task subcommand without id traces latest from store", async () => {
    const { store } = createTestTraceStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_old",
      event: "lifecycle.start",
      fields: { model: "gpt-5", mode: "work" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_latest",
      event: "lifecycle.start",
      fields: { model: "gpt-5", mode: "work" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task"], deps);
    expect(output()).toContain("task_latest");
    expect(output()).not.toContain("task_old");
  });

  test("--log flag falls back to file parsing even with store", async () => {
    const { store } = createTestTraceStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_store",
      event: "lifecycle.start",
      fields: { model: "m", mode: "work" },
    });
    const logContent = "2026-01-01T00:00:00Z event=lifecycle.start task_id=task_file mode=work model=m";
    const { deps, output } = createDeps({
      traceStore: store,
      readFile: async () => logContent,
    });
    await traceMode(["--log", "/some/path", "task", "task_file"], deps);
    expect(output()).toContain("task_file");
    expect(output()).not.toContain("task_store");
  });

  test("unknown subcommand with store calls commandError", async () => {
    const { store } = createTestTraceStore();
    let errorMsg = "";
    const { deps } = createDeps({
      traceStore: store,
      commandError: (_name, msg) => {
        errorMsg = msg ?? "";
      },
    });
    await traceMode(["bogus"], deps);
    expect(errorMsg).toContain("Unknown subcommand");
  });

  test("empty store prints no tasks", async () => {
    const { store } = createTestTraceStore();
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task"], deps);
    expect(output()).toContain("No tasks");
  });
});
