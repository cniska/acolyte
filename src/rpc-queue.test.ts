import { describe, expect, test } from "bun:test";
import {
  dequeueNextQueuedChat,
  type QueuedRpcChatEntry,
  queuePositionUpdates,
  removeQueuedChatById,
} from "./rpc-queue";

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

  test("queuePositionUpdates returns 1-based positions for queued chats", () => {
    const queue: QueuedRpcChatEntry[] = [
      { id: "chat_1", state: { aborted: false } },
      { id: "chat_2", state: { aborted: false } },
    ];

    expect(queuePositionUpdates(queue)).toEqual([
      { id: "chat_1", position: 1 },
      { id: "chat_2", position: 2 },
    ]);
  });

  test("dequeueNextQueuedChat returns first non-aborted entry and updates positions", () => {
    type Entry = QueuedRpcChatEntry & { requestId: string };
    const queue: Entry[] = [
      { id: "chat_1", state: { aborted: true }, requestId: "req_1" },
      { id: "chat_2", state: { aborted: false }, requestId: "req_2" },
      { id: "chat_3", state: { aborted: false }, requestId: "req_3" },
    ];

    const result = dequeueNextQueuedChat(queue);

    expect(result.next?.id).toBe("chat_2");
    expect(result.next?.requestId).toBe("req_2");
    expect(result.updates).toEqual([{ id: "chat_3", position: 1 }]);
    expect(queue.map((item) => item.id)).toEqual(["chat_3"]);
  });

  test("dequeueNextQueuedChat returns null when queue is empty or fully aborted", () => {
    const emptyResult = dequeueNextQueuedChat([]);
    expect(emptyResult.next).toBeNull();
    expect(emptyResult.updates).toEqual([]);

    const abortedOnly: QueuedRpcChatEntry[] = [
      { id: "chat_1", state: { aborted: true } },
      { id: "chat_2", state: { aborted: true } },
    ];
    const abortedResult = dequeueNextQueuedChat(abortedOnly);
    expect(abortedResult.next).toBeNull();
    expect(abortedResult.updates).toEqual([]);
    expect(abortedOnly).toEqual([]);
  });
});
