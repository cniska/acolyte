import type { TaskRecord, TaskState } from "./task-state";

type TaskPatch = {
  state?: TaskState;
  summary?: string;
};

const ALLOWED_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  running: ["detached", "completed", "failed", "cancelled"],
  detached: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export type TaskTransitionResult =
  | { ok: true; task: TaskRecord }
  | {
      ok: false;
      code: "E_TASK_INVALID_TRANSITION";
      taskId: string;
      fromState: TaskState;
      toState: TaskState;
    };

export function canTransitionTaskState(fromState: TaskState, toState: TaskState): boolean {
  if (fromState === toState) return true;
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

export class TaskRegistry {
  private readonly tasks = new Map<string, TaskRecord>();

  transitionTask(taskId: string, patch: TaskPatch): TaskTransitionResult {
    const now = new Date().toISOString();
    const existing = this.tasks.get(taskId);
    if (existing && patch.state && !canTransitionTaskState(existing.state, patch.state)) {
      return {
        ok: false,
        code: "E_TASK_INVALID_TRANSITION",
        taskId,
        fromState: existing.state,
        toState: patch.state,
      };
    }
    const next: TaskRecord = {
      id: taskId,
      state: patch.state ?? existing?.state ?? "running",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      summary: patch.summary ?? existing?.summary,
    };
    this.tasks.set(taskId, next);
    return { ok: true, task: next };
  }

  get(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }
}
