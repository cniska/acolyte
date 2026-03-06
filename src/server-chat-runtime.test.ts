import { describe, expect, test } from "bun:test";
import { buildMemoryQualityWarningLogFields } from "./server-chat-runtime";

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
});
