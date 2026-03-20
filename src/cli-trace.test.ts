import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { traceMode } from "./cli-trace";
import { tempDir } from "./test-utils";
import { createTraceStore, type TraceStore } from "./trace-store";

type TraceDeps = Parameters<typeof traceMode>[1];
const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

function createTestStore(): TraceStore {
  const dir = createDir("acolyte-trace-cli-");
  return createTraceStore(join(dir, "trace.db"));
}

function createDeps(overrides?: Partial<TraceDeps>): { deps: TraceDeps; output: () => string } {
  const lines: string[] = [];
  const deps: TraceDeps = {
    hasHelpFlag: () => false,
    traceStore: createTestStore(),
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(`ERROR: ${message}`),
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
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_latest",
      event: "lifecycle.start",
      fields: { mode: "work", model: "gpt-5" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task"], deps);
    expect(output()).toContain("task_latest");
  });

  test("task subcommand without id and empty store prints no tasks", async () => {
    const { deps, output } = createDeps();
    await traceMode(["task"], deps);
    expect(output()).toContain("No tasks");
  });

  test("task subcommand filters by exact id", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_12",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    expect(output()).toContain("task_id=task_1");
    expect(output()).not.toContain("task_id=task_12");
  });

  test("default lists recent tasks", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_a",
      event: "lifecycle.start",
      fields: { mode: "work", model: "gpt-5-mini" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_b",
      event: "lifecycle.start",
      fields: { mode: "work", model: "gpt-5-mini" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode([], deps);
    expect(output()).toContain("task_b");
    expect(output()).toContain("task_a");
  });

  test("--lines flag controls list count", async () => {
    const store = createTestStore();
    for (let i = 0; i < 100; i++) {
      store.write({
        timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
        taskId: `task_${i}`,
        event: "lifecycle.start",
        fields: { model: "m" },
      });
    }
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["--lines", "5"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(6);
  });

  test("--json outputs JSON lines for task subcommand", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "gpt-5-mini" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.tool.call",
      fields: { tool: "read-file", path: "src/cli.ts" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]) as Record<string, string>;
    expect(first.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(first.event).toBe("lifecycle.start");
    expect(first.task_id).toBe("task_1");
  });

  test("--json omits header lines", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });

  test("empty store prints no tasks for list", async () => {
    const { deps, output } = createDeps();
    await traceMode([], deps);
    expect(output()).toContain("No tasks");
  });

  test("missing store prints no trace data message", async () => {
    const { deps, output } = createDeps({ traceStore: undefined });
    await traceMode([], deps);
    expect(output()).toContain("No trace data available");
  });
});
