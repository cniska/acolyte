export interface TaskQueue {
  enqueue<T>(key: string, job: () => Promise<T>): Promise<T>;
  enqueueMany<T>(keys: readonly string[], job: () => Promise<T>): Promise<T>;
}

export function createInMemoryTaskQueue(): TaskQueue {
  const queueByKey = new Map<string, Promise<void>>();
  return {
    enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
      return this.enqueueMany([key], job);
    },
    enqueueMany<T>(keys: readonly string[], job: () => Promise<T>): Promise<T> {
      const uniqueKeys = [...new Set(keys)];
      const previous = Promise.all(uniqueKeys.map((key) => (queueByKey.get(key) ?? Promise.resolve()).catch(() => {})));
      const next = previous.then(job);
      const queued = next.then(() => {});
      for (const key of uniqueKeys) queueByKey.set(key, queued);
      void queued
        .catch(() => {})
        .finally(() => {
          for (const key of uniqueKeys) {
            if (queueByKey.get(key) === queued) queueByKey.delete(key);
          }
        });
      return next;
    },
  };
}
