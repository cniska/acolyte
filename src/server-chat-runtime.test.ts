import { describe, expect, test } from "bun:test";
import { buildMemoryQualityWarningLogFields, logLifecycleDebugEntry } from "./server-chat-runtime";

describe("server chat runtime", () => {
  test("buildMemoryQualityWarningLogFields returns null for non-warning events", () => {
    const result = buildMemoryQualityWarningLogFields({
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      event: "lifecycle.memory.commit_done",
      eventTs: "2026-03-06T10:00:00.000Z",
      fields: { malformed_reject_streak: 2 },
    });
    expect(result).toBeNull();
  });

  test("buildMemoryQualityWarningLogFields returns grep-friendly warning payload", () => {
    const result = buildMemoryQualityWarningLogFields({
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      event: "lifecycle.memory.quality_warning",
      eventTs: "2026-03-06T10:00:00.000Z",
      fields: {
        warning: "repeated_malformed_scope_tags",
        malformed_reject_streak: 3,
        malformed_tagged_facts: 2,
        queue_key: "sess_1",
      },
    });
    expect(result).toEqual({
      request_id: "err_abc123",
      task_id: "task_1",
      session_id: "sess_1",
      event: "lifecycle.memory.quality_warning",
      event_ts: "2026-03-06T10:00:00.000Z",
      warning: "repeated_malformed_scope_tags",
      malformed_reject_streak: 3,
      malformed_tagged_facts: 2,
      queue_key: "sess_1",
    });
  });

  test("logLifecycleDebugEntry logs both agent debug and memory warning for quality_warning events", () => {
    const logs: Array<{ message: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    logLifecycleDebugEntry({
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      event: "lifecycle.memory.quality_warning",
      sequence: 7,
      phaseAttempt: 2,
      eventTs: "2026-03-06T10:00:00.000Z",
      fields: {
        warning: "repeated_malformed_scope_tags",
        malformed_reject_streak: 3,
        malformed_tagged_facts: 2,
        queue_key: "sess_1",
      },
      logInfo: (message, fields) => {
        logs.push({ message, fields });
      },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.message).toBe("agent debug");
    expect(logs[0]?.fields?.event).toBe("lifecycle.memory.quality_warning");
    expect(logs[1]?.message).toBe("memory quality warning");
    expect(logs[1]?.fields?.warning).toBe("repeated_malformed_scope_tags");
    expect(logs[1]?.fields?.malformed_reject_streak).toBe(3);
  });

  test("logLifecycleDebugEntry logs only agent debug for non-warning events", () => {
    const logs: Array<{ message: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    logLifecycleDebugEntry({
      requestId: "err_abc123",
      taskId: "task_1",
      sessionId: "sess_1",
      event: "lifecycle.memory.commit_done",
      sequence: 8,
      phaseAttempt: 2,
      eventTs: "2026-03-06T10:00:01.000Z",
      fields: {
        project_promoted_facts: 1,
      },
      logInfo: (message, fields) => {
        logs.push({ message, fields });
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("agent debug");
    expect(logs[0]?.fields?.event).toBe("lifecycle.memory.commit_done");
  });
});
