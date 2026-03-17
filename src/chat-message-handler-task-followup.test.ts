import { describe, expect, test } from "bun:test";
import type { ChatEntry } from "./chat-contract";
import { startRemoteTaskFollowup } from "./chat-message-handler-task-followup";

describe("chat-message-handler-task-followup", () => {
  test("returns false when task status is unavailable", async () => {
    const rows: ChatEntry[] = [];
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
      setProgressText: () => {},
      persist: async () => {},
      stopWorking: () => {},
    });
    expect(started).toBe(false);
  });
});
