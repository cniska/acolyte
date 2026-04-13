import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { logLifecycleDebugEntry } from "./server-chat-runtime";
import { tempDir } from "./test-utils";
import { createTraceStore } from "./trace-store";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("server chat runtime", () => {
  test("logLifecycleDebugEntry dual-writes to trace store", () => {
    const dir = createDir("acolyte-trace-srv-");
    const store = createTraceStore(join(dir, "trace.db"));
    logLifecycleDebugEntry({
      requestId: "err_xyz789",
      taskId: "task_dual",
      sessionId: "sess_dual",
      event: "lifecycle.start",
      sequence: 1,
      eventTs: "2026-03-20T12:00:00.000Z",
      fields: { model: "gpt-5", mode: "work" },
      logInfo: () => {},
      traceStore: store,
    });
    const lines = store.listByTaskId("task_dual");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.event).toBe("lifecycle.start");
    expect(lines[0]?.fields.model).toBe("gpt-5");
    store.close();
  });
});
