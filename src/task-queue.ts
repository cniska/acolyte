export interface TaskQueue {
  enqueue(key: string, job: () => Promise<void>): Promise<void>;
}

export function createInMemoryTaskQueue(): TaskQueue {
  const queueByKey = new Map<string, Promise<void>>();
  return {
    enqueue(key, job) {
      const previous = queueByKey.get(key) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(job);
      queueByKey.set(key, next);
      void next.finally(() => {
        if (queueByKey.get(key) === next) queueByKey.delete(key);
      });
      return next;
    },
  };
}
