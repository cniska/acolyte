import { z } from "zod";
import { sessionIdSchema } from "./session-contract";
import { taskIdSchema } from "./task-contract";

export const liveTaskSchema = z.object({
  taskId: taskIdSchema,
  sessionId: sessionIdSchema.nullable(),
});
export type LiveTask = z.infer<typeof liveTaskSchema>;

export const shutdownRequestSchema = z.object({
  force: z.boolean().default(false),
});
export type ShutdownRequest = z.infer<typeof shutdownRequestSchema>;

export const shutdownResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), shutdown: z.literal(true) }),
  z.object({ ok: z.literal(false), live: z.array(liveTaskSchema) }),
]);
export type ShutdownResponse = z.infer<typeof shutdownResponseSchema>;

export function parseShutdownRequest(payload: unknown): ShutdownRequest {
  const result = shutdownRequestSchema.safeParse(payload);
  return result.success ? result.data : { force: false };
}

export function parseShutdownResponse(payload: unknown): ShutdownResponse | null {
  const result = shutdownResponseSchema.safeParse(payload);
  return result.success ? result.data : null;
}
