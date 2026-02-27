import { z } from "zod";

export const streamErrorDetailSchema = z.object({
  code: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  tool: z.string().optional(),
  retryable: z.boolean().optional(),
  recoveryAction: z.string().optional(),
});

export type StreamErrorDetail = z.infer<typeof streamErrorDetailSchema>;
