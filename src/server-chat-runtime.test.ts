import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { appConfig } from "./app-config";
import { logLifecycleDebugEntry, runChatRequest } from "./server-chat-runtime";
import type { StreamErrorPayload } from "./server-contract";
import { tempDir } from "./test-utils";
import { createTraceStore } from "./trace-store";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("server chat runtime", () => {
  test("logLifecycleDebugEntry logs agent debug entry", () => {
    const logs: Array<{ message: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    logLifecycleDebugEntry({
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      event: "lifecycle.memory.commit_done",
      sequence: 8,
      eventTs: "2026-03-06T10:00:01.000Z",
      fields: {
        project_promoted_facts: 1,
      },
      logInfo: (message, fields) => {
        logs.push({ message, fields });
      },
      traceStore: null,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("agent debug");
    expect(logs[0]?.fields?.event).toBe("lifecycle.memory.commit_done");
  });

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

  test("vercel provider error mentions AI_GATEWAY_API_KEY", async () => {
    const savedKey = appConfig.vercel.apiKey;
    (appConfig.vercel as { apiKey: string | undefined }).apiKey = undefined;
    try {
      const errors: StreamErrorPayload[] = [];
      await runChatRequest(
        { model: "minimax/minimax-m2.7", message: "hi", history: [] },
        {
          path: "/test",
          method: "POST",
          onEvent: () => {},
          onDone: () => {},
          onError: (payload) => errors.push(payload),
        },
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]?.errorMessage).toContain("AI_GATEWAY_API_KEY");
    } finally {
      (appConfig.vercel as { apiKey: string | undefined }).apiKey = savedKey;
    }
  });
});
