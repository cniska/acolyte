import type { TaskId, TaskRecord } from "./task-contract";

export interface TaskStore {
  size(): number;
  entries(): IterableIterator<[TaskId, TaskRecord]>;
  values(): IterableIterator<TaskRecord>;
  get(taskId: TaskId): TaskRecord | null;
  set(taskId: TaskId, record: TaskRecord): void;
  delete(taskId: TaskId): void;
}

export function createInMemoryTaskStore(): TaskStore {
  const records = new Map<string, TaskRecord>();
  return {
    size: () => records.size,
    entries: () => records.entries(),
    values: () => records.values(),
    get: (taskId) => records.get(taskId) ?? null,
    set: (taskId, record) => {
      records.set(taskId, record);
    },
    delete: (taskId) => {
      records.delete(taskId);
    },
  };
}
