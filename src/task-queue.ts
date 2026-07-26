export interface TaskQueue {
  enqueue(key: string, job: () => Promise<void>): Promise<void>;
  enqueueMany(keys: readonly string[], job: () => Promise<void>): Promise<void>;
}

export function createInMemoryTaskQueue(): TaskQueue {
  const queueByKey = new Map<string, Promise<void>>();
  return {
    enqueue(key, job) {
      return this.enqueueMany([key], job);
    },
    enqueueMany(keys, job) {
      const uniqueKeys = [...new Set(keys)];
      const previous = Promise.all(uniqueKeys.map((key) => (queueByKey.get(key) ?? Promise.resolve()).catch(() => {})));
      const next = previous.then(job);
      for (const key of uniqueKeys) queueByKey.set(key, next);
      void next
        .catch(() => {})
        .finally(() => {
          for (const key of uniqueKeys) {
            if (queueByKey.get(key) === next) queueByKey.delete(key);
          }
        });
      return next;
    },
  };
}
