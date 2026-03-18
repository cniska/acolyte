import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { startRemoteTaskFollowup } from "./chat-message-handler-task-followup";

describe("chat-message-handler-task-followup", () => {
  test("returns false when task status is unavailable", async () => {
    const rows: ChatRow[] = [];
    const started = await startRemoteTaskFollowup({
      client: {
        replyStream: async () => {
          throw new Error("not used");
        },
        status: async () => ({}),
        taskStatus: async () => null,
      },
      remoteTaskId: "task_1",
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setPendingState: () => {},
      persist: async () => {},
      onStopPending: () => {},
    });
    expect(started).toBe(false);
  });
});
