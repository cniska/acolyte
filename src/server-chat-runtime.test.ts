import { describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import {
  claimTraceSinkNotice,
  isChatRequest,
  logLifecycleDebugEntry,
  resetTraceSinkNoticeLatch,
  runChatRequest,
  traceSinkNoticeMessage,
} from "./server-chat-runtime";
import type { StreamErrorPayload } from "./server-contract";
import type { TraceStore } from "./trace-store";

const debugEntry = {
  requestId: "err_abc123",
  taskId: "task_1",
  sessionId: "sess_1",
  event: "lifecycle.summary",
  sequence: 1,
  eventTs: "2026-03-06T10:00:00.000Z",
  logInfo: () => {},
};

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

  test("verbose-only events use debug log level", () => {
    const infoLogs: string[] = [];
    const debugLogs: string[] = [];
    const base = {
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      sequence: 1,
      eventTs: "2026-03-06T10:00:00.000Z",
      traceStore: null,
      logInfo: (msg: string) => infoLogs.push(msg),
      logDebug: (msg: string) => debugLogs.push(msg),
    };

    logLifecycleDebugEntry({ ...base, event: "lifecycle.tool.output" });
    logLifecycleDebugEntry({ ...base, event: "lifecycle.tool.cache" });
    logLifecycleDebugEntry({ ...base, event: "lifecycle.tool.call" });

    expect(debugLogs).toHaveLength(2);
    expect(infoLogs).toHaveLength(1);
    expect(infoLogs[0]).toBe("agent debug");
  });

  test("logLifecycleDebugEntry reports 'written' when the store accepts the write", () => {
    const writes: unknown[] = [];
    const store = { write: (e: unknown) => writes.push(e) } as unknown as TraceStore;
    const health = logLifecycleDebugEntry({ ...debugEntry, traceStore: store });
    expect(health).toBe("written");
    expect(writes).toHaveLength(1);
  });

  test("logLifecycleDebugEntry reports 'store-unavailable' when there is no store", () => {
    expect(logLifecycleDebugEntry({ ...debugEntry, traceStore: null })).toBe("store-unavailable");
  });

  test("a failing trace write is reported, never propagated to the request hot path", () => {
    const store = {
      write: () => {
        throw new Error("disk full");
      },
    } as unknown as TraceStore;
    // Regression: store acquisition/write used to sit outside a guard and could crash the
    // request it only observes. It must degrade to a health signal, not throw.
    expect(() => logLifecycleDebugEntry({ ...debugEntry, traceStore: store })).not.toThrow();
    expect(logLifecycleDebugEntry({ ...debugEntry, traceStore: store })).toBe("write-failed");
  });

  test("trace-sink notice latches once per failure kind per process", () => {
    resetTraceSinkNoticeLatch();
    expect(claimTraceSinkNotice("store-unavailable")).toBe(true);
    expect(claimTraceSinkNotice("store-unavailable")).toBe(false);
    // A distinct failure kind still gets its own first report.
    expect(claimTraceSinkNotice("write-failed")).toBe(true);
    resetTraceSinkNoticeLatch();
    expect(claimTraceSinkNotice("store-unavailable")).toBe(true);
  });

  test("trace-sink notice message names the cause and pluralizes the count", () => {
    expect(traceSinkNoticeMessage("store-unavailable", 1)).toContain("could not be opened");
    expect(traceSinkNoticeMessage("store-unavailable", 1)).toContain("1 diagnostic event was not recorded");
    expect(traceSinkNoticeMessage("write-failed", 3)).toContain("writes are failing");
    expect(traceSinkNoticeMessage("write-failed", 3)).toContain("3 diagnostic events were not recorded");
  });

  test("isChatRequest rejects malformed activeSkills entries", () => {
    expect(
      isChatRequest({
        model: "gpt-5-mini",
        message: "hi",
        history: [],
        activeSkills: [1],
      }),
    ).toBe(false);
    expect(
      isChatRequest({
        model: "gpt-5-mini",
        message: "hi",
        history: [],
        activeSkills: [{ name: "build" }],
      }),
    ).toBe(false);
  });
});
