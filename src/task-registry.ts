import { isTerminalTaskState, type TaskRecord, type TaskState } from "./task-state";

type TaskPatch = {
  state?: TaskState;
  summary?: string;
};

const ALLOWED_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  accepted: ["queued", "running", "cancelled"],
  queued: ["running", "cancelled"],
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
  private readonly maxTasks: number;

  constructor(options?: { maxTasks?: number }) {
    this.maxTasks = Math.max(1, options?.maxTasks ?? 1000);
  }

  private pruneIfNeeded(): void {
    while (this.tasks.size > this.maxTasks) {
      let oldestTerminalId: string | null = null;
      let oldestTerminalCreatedAt = "";
      for (const [taskId, task] of this.tasks.entries()) {
        if (!isTerminalTaskState(task.state)) continue;
        if (!oldestTerminalId || task.createdAt < oldestTerminalCreatedAt) {
          oldestTerminalId = taskId;
          oldestTerminalCreatedAt = task.createdAt;
        }
      }
      if (!oldestTerminalId) break;
      this.tasks.delete(oldestTerminalId);
    }
  }

  summary(): {
    total: number;
    running: number;
    detached: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    let running = 0;
    let detached = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    for (const task of this.tasks.values()) {
      if (task.state === "running") running += 1;
      if (task.state === "detached") detached += 1;
      if (task.state === "completed") completed += 1;
      if (task.state === "failed") failed += 1;
      if (task.state === "cancelled") cancelled += 1;
    }
    return {
      total: this.tasks.size,
      running,
      detached,
      completed,
      failed,
      cancelled,
    };
  }

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
      state: patch.state ?? existing?.state ?? "accepted",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      summary: patch.summary ?? existing?.summary,
    };
    this.tasks.set(taskId, next);
    this.pruneIfNeeded();
    return { ok: true, task: next };
  }

  get(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) ?? null;
  }
}
