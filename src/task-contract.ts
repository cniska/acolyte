import { z } from "zod";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

export const taskStateSchema = z.enum([
  "accepted",
  "queued",
  "running",
  "detached",
  "completed",
  "failed",
  "cancelled",
]);
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
export const taskIdSchema = domainIdSchema("task");
export type TaskId = z.infer<typeof taskIdSchema>;

export const taskRecordSchema = z.object({
  id: taskIdSchema,
  state: taskStateSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type TaskRecord = Readonly<z.infer<typeof taskRecordSchema>>;

export function parseTaskRecord(payload: unknown): TaskRecord | null {
  const result = taskRecordSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state as (typeof TERMINAL_TASK_STATES)[number]);
}
