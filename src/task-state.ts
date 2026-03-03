import { z } from "zod";

export const taskStateSchema = z.enum(["accepted", "queued", "running", "detached", "completed", "failed", "cancelled"]);
export const taskTransitionReasonSchema = z.enum([
  "chat_accepted",
  "chat_started",
  "chat_completed",
  "chat_failed",
  "abort_requested",
  "connection_closed",
]);

export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskTransitionReason = z.infer<typeof taskTransitionReasonSchema>;

export const TERMINAL_TASK_STATES = ["completed", "failed", "cancelled"] as const;

export const taskRecordSchema = z.object({
  id: z.string().min(1),
  state: taskStateSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  summary: z.string().optional(),
});

export type TaskRecord = z.infer<typeof taskRecordSchema>;

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state as (typeof TERMINAL_TASK_STATES)[number]);
}
