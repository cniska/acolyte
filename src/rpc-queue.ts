export type QueuedRpcChatState = { aborted: boolean };

export type QueuedRpcChatEntry = {
  id: string;
  state: QueuedRpcChatState;
};

export type QueueAbortResult = {
  removed: boolean;
  updates: Array<{ id: string; position: number }>;
};

export function queuePositionUpdates(queue: QueuedRpcChatEntry[]): Array<{ id: string; position: number }> {
  return queue.map((item, position) => ({ id: item.id, position: position + 1 }));
}

export function removeQueuedChatById(queue: QueuedRpcChatEntry[], requestId: string): QueueAbortResult {
  const index = queue.findIndex((item) => item.id === requestId);
  if (index === -1) return { removed: false, updates: [] };
  queue[index].state.aborted = true;
  queue.splice(index, 1);
  return {
    removed: true,
    updates: queuePositionUpdates(queue),
  };
}
