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
    expect(output()).toContain("task_1");
    expect(output()).not.toContain("task_12");
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
      fields: { tool: "file-read", path: "src/cli.ts" },
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

  test("default compact output shows tool name and duration, not raw events", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.100Z",
      taskId: "task_1",
      event: "lifecycle.tool.call",
      fields: { tool: "code-edit", path: "src/foo.ts" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.545Z",
      taskId: "task_1",
      event: "lifecycle.tool.result",
      fields: { tool: "code-edit", duration_ms: "445", is_error: "false" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.summary",
      fields: { model_calls: "1", tool_calls: "1", write_calls: "1", has_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    const text = output();
    expect(text).toContain("code-edit");
    expect(text).toContain("src/foo.ts");
    expect(text).toContain("445ms");
    expect(text).toContain("status=ok");
    expect(text).not.toContain("lifecycle.tool.call");
    expect(text).not.toContain("lifecycle.tool.result");
  });

  test("task list shows blocked status for blocked tasks", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_blocked",
      event: "lifecycle.start",
      fields: { mode: "work", model: "gpt-5-mini" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_blocked",
      event: "lifecycle.summary",
      fields: { has_error: "false", lifecycle_signal: "blocked" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode([], deps);
    const text = output();
    expect(text).toContain("blocked");
    expect(text).not.toContain("ok");
  });

  test("compact output shows BLOCKED for budget exhaustion", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.100Z",
      taskId: "task_1",
      event: "lifecycle.tool.call",
      fields: { tool: "file-edit", path: "src/foo.ts" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.200Z",
      taskId: "task_1",
      event: "lifecycle.budget",
      fields: { tool: "file-edit", action: "blocked", detail: "cycle-limit" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.200Z",
      taskId: "task_1",
      event: "lifecycle.tool.result",
      fields: { tool: "file-edit", duration_ms: "100", is_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    const text = output();
    expect(text).toContain("BLOCKED");
    expect(text).toContain("budget");
  });

  test("compact output hides eval done events", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.eval.decision",
      fields: { effect: "format", action: "done" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:02.000Z",
      taskId: "task_1",
      event: "lifecycle.summary",
      fields: { model_calls: "1", tool_calls: "0", has_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    const text = output();
    expect(text).not.toContain("action=done");
  });

  test("compact output renders summary footer", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:05.000Z",
      taskId: "task_1",
      event: "lifecycle.summary",
      fields: {
        model_calls: "3",
        tool_calls: "5",
        read_calls: "2",
        search_calls: "1",
        write_calls: "2",
        budget_exhausted_count: "1",
        has_error: "true",
      },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    const text = output();
    expect(text).toContain("model_calls=3");
    expect(text).toContain("tools=5");
    expect(text).toContain("read=2");
    expect(text).toContain("write=2");
    expect(text).toContain("budget_exhausted=1");
    expect(text).toContain("status=error");
  });

  test("compact output hides setup events", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.workspace.profile",
      fields: { ecosystem: "typescript", package_manager: "bun" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.001Z",
      taskId: "task_1",
      event: "lifecycle.prepare",
      fields: { mode: "work", model: "m", history_messages: "2" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.002Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.003Z",
      taskId: "task_1",
      event: "lifecycle.generate.start",
      fields: { model: "m", mode: "work" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.generate.done",
      fields: { model: "m", tool_calls: "0", text_chars: "5" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.001Z",
      taskId: "task_1",
      event: "lifecycle.summary",
      fields: { model_calls: "1", tool_calls: "0", has_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1"], deps);
    const text = output();
    expect(text).not.toContain("workspace.profile");
    expect(text).not.toContain("prepare");
    expect(text).not.toContain("generate.start");
    expect(text).not.toContain("generate.done");
    expect(text).toContain("task_1");
    expect(text).toContain("status=ok");
  });

  test("--json outputs raw events not compact format", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.start",
      fields: { mode: "work", model: "m" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.100Z",
      taskId: "task_1",
      event: "lifecycle.tool.call",
      fields: { tool: "file-read", path: "src/a.ts" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.summary",
      fields: { model_calls: "1", tool_calls: "1", has_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1", "--json"], deps);
    const text = output();
    const lines = text.split("\n");
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
    expect(text).toContain("lifecycle.start");
    expect(text).toContain("lifecycle.tool.call");
    expect(text).not.toContain("──");
  });

  test("task subcommand --verbose shows tool.output and tool.cache events", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.tool.call",
      fields: { tool: "code-edit", path: "." },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.001Z",
      taskId: "task_1",
      event: "lifecycle.tool.output",
      fields: { tool: "code-edit" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.002Z",
      taskId: "task_1",
      event: "lifecycle.tool.cache",
      fields: { tool: "code-edit", hit: "false" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:01.000Z",
      taskId: "task_1",
      event: "lifecycle.tool.result",
      fields: { tool: "code-edit", duration_ms: "445", is_error: "false" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1", "--verbose"], deps);
    const text = output();
    expect(text).toContain("lifecycle.tool.output");
    expect(text).toContain("lifecycle.tool.cache");
  });

  test("task subcommand --verbose shows effect events with fields", async () => {
    const store = createTestStore();
    store.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      taskId: "task_1",
      event: "lifecycle.effect.format",
      fields: { files: "2" },
    });
    store.write({
      timestamp: "2026-01-01T00:00:00.100Z",
      taskId: "task_1",
      event: "lifecycle.effect.lint",
      fields: { files: "2" },
    });
    const { deps, output } = createDeps({ traceStore: store });
    await traceMode(["task", "task_1", "--verbose"], deps);
    const text = output();
    expect(text).toContain("lifecycle.effect.format");
    expect(text).toContain("lifecycle.effect.lint");
    expect(text).toContain("files");
    expect(text).toContain("2");
  });
});
