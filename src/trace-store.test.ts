import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import type { TraceEntry } from "./trace-store";
import { createTraceStore } from "./trace-store";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

function createStore(dir: string) {
  return createTraceStore(join(dir, "test-trace.db"));
}

function entry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    timestamp: overrides.timestamp ?? "2026-03-20T10:00:00.000Z",
    taskId: overrides.taskId ?? "task_1",
    requestId: overrides.requestId ?? "err_abc",
    sessionId: overrides.sessionId ?? "sess_1",
    event: overrides.event ?? "lifecycle.start",
    sequence: overrides.sequence ?? 1,
    phaseAttempt: overrides.phaseAttempt ?? 0,
    fields: overrides.fields ?? { model: "gpt-5-mini", mode: "work" },
  };
}

describe("createTraceStore", () => {
  test("write + listByTaskId round-trips an entry", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry());
    const lines = store.listByTaskId("task_1");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.timestamp).toBe("2026-03-20T10:00:00.000Z");
    expect(lines[0]?.taskId).toBe("task_1");
    expect(lines[0]?.requestId).toBe("err_abc");
    expect(lines[0]?.fields.event).toBe("lifecycle.start");
    expect(lines[0]?.fields.model).toBe("gpt-5-mini");
    expect(lines[0]?.fields.mode).toBe("work");
    store.close();
  });

  test("listByTaskId returns empty for unknown task", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    expect(store.listByTaskId("task_missing")).toEqual([]);
    store.close();
  });

  test("listByTaskId isolates tasks", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ taskId: "task_a", event: "lifecycle.start" }));
    store.write(entry({ taskId: "task_b", event: "lifecycle.summary" }));
    const a = store.listByTaskId("task_a");
    const b = store.listByTaskId("task_b");
    expect(a).toHaveLength(1);
    expect(a[0]?.fields.event).toBe("lifecycle.start");
    expect(b).toHaveLength(1);
    expect(b[0]?.fields.event).toBe("lifecycle.summary");
    store.close();
  });

  test("listByTaskId preserves insertion order", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ timestamp: "2026-03-20T10:00:00.000Z", event: "lifecycle.start" }));
    store.write(entry({ timestamp: "2026-03-20T10:00:01.000Z", event: "lifecycle.generate.start" }));
    store.write(entry({ timestamp: "2026-03-20T10:00:02.000Z", event: "lifecycle.summary" }));
    const lines = store.listByTaskId("task_1");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.fields.event).toBe("lifecycle.start");
    expect(lines[1]?.fields.event).toBe("lifecycle.generate.start");
    expect(lines[2]?.fields.event).toBe("lifecycle.summary");
    store.close();
  });

  test("listTasks returns tasks ordered newest first", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ taskId: "task_old", timestamp: "2026-03-20T09:00:00.000Z" }));
    store.write(entry({ taskId: "task_new", timestamp: "2026-03-20T10:00:00.000Z" }));
    const tasks = store.listTasks(10);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.taskId).toBe("task_new");
    expect(tasks[1]?.taskId).toBe("task_old");
    store.close();
  });

  test("listTasks respects limit", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    for (let i = 0; i < 5; i++) {
      store.write(entry({ taskId: `task_${i}`, timestamp: `2026-03-20T10:0${i}:00.000Z` }));
    }
    const tasks = store.listTasks(3);
    expect(tasks).toHaveLength(3);
    store.close();
  });

  test("listTasks extracts model from lifecycle.start fields", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ taskId: "task_m", event: "lifecycle.start", fields: { model: "gpt-5", mode: "work" } }));
    const tasks = store.listTasks(10);
    expect(tasks[0]?.model).toBe("gpt-5");
    store.close();
  });

  test("listTasks detects hasError from lifecycle.summary", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ taskId: "task_err", event: "lifecycle.start" }));
    store.write(
      entry({
        taskId: "task_err",
        event: "lifecycle.summary",
        timestamp: "2026-03-20T10:00:01.000Z",
        fields: { has_error: "true", model_calls: "3" },
      }),
    );
    const tasks = store.listTasks(10);
    expect(tasks[0]?.hasError).toBe(true);
    store.close();
  });

  test("listTasks returns hasError false when no error", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry({ taskId: "task_ok", event: "lifecycle.start" }));
    store.write(
      entry({
        taskId: "task_ok",
        event: "lifecycle.summary",
        timestamp: "2026-03-20T10:00:01.000Z",
        fields: { has_error: "false", model_calls: "1" },
      }),
    );
    const tasks = store.listTasks(10);
    expect(tasks[0]?.hasError).toBe(false);
    store.close();
  });

  test("raw field is empty string for SQLite-sourced lines", () => {
    const dir = createDir("acolyte-trace-");
    const store = createStore(dir);
    store.write(entry());
    const lines = store.listByTaskId("task_1");
    expect(lines[0]?.raw).toBe("");
    store.close();
  });
});
