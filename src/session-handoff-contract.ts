import { z } from "zod";

export const handoffRequestSchema = z
  .object({
    kind: z.literal("session-handoff"),
    requested: z.literal(true),
    reason: z.string().min(1).optional(),
  })
  .strict();

export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
