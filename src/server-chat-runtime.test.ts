import { describe, expect, test } from "bun:test";
import { logLifecycleDebugEntry } from "./server-chat-runtime";

describe("server chat runtime", () => {
  test("logLifecycleDebugEntry logs agent debug entry", () => {
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
