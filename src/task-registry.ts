import type { TaskRecord, TaskState } from "./task-state";

type TaskPatch = {
  state?: TaskState;
  summary?: string;
};

export class TaskRegistry {
  private readonly tasks = new Map<string, TaskRecord>();

  upsert(taskId: string, patch: TaskPatch): TaskRecord {
    const now = new Date().toISOString();
    const existing = this.tasks.get(taskId);
    const next: TaskRecord = {
      id: taskId,
      state: patch.state ?? existing?.state ?? "running",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      summary: patch.summary ?? existing?.summary,
    };
    this.tasks.set(taskId, next);
    return next;
  }

  get(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }
}
