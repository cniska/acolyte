import { z } from "zod";

export const streamErrorSchema = z.object({
  code: z.string().optional(),
  category: z.string().optional(),
  kind: z.string().optional(),
  source: z.string().optional(),
  tool: z.string().optional(),
});

export type StreamError = z.infer<typeof streamErrorSchema>;
