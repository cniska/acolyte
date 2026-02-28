import { describe, expect, test } from "bun:test";
import { type QueuedRpcChatEntry, removeQueuedChatById } from "./rpc-queue";

describe("rpc queue", () => {
  test("removeQueuedChatById removes target and reindexes remaining queue", () => {
    const queue: QueuedRpcChatEntry[] = [
      { id: "chat_1", state: { aborted: false } },
      { id: "chat_2", state: { aborted: false } },
      { id: "chat_3", state: { aborted: false } },
    ];

    const result = removeQueuedChatById(queue, "chat_2");

    expect(result.removed).toBe(true);
    expect(queue.map((item) => item.id)).toEqual(["chat_1", "chat_3"]);
    expect(result.updates).toEqual([
      { id: "chat_1", position: 1 },
      { id: "chat_3", position: 2 },
    ]);
  });

  test("removeQueuedChatById returns no-op result when request is missing", () => {
    const queue: QueuedRpcChatEntry[] = [{ id: "chat_1", state: { aborted: false } }];
    const result = removeQueuedChatById(queue, "missing");
    expect(result.removed).toBe(false);
    expect(queue.map((item) => item.id)).toEqual(["chat_1"]);
    expect(result.updates).toEqual([]);
  });
});
