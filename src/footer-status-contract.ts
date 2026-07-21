import { z } from "zod";
import { prInfoSchema } from "./gh-contract";

export const footerStatusSchema = z.object({
  repo: z.string(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  dirty: z.boolean(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  model: z.string(),
  effort: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  pr: prInfoSchema.nullable(),
  skills: z.array(z.string()).readonly(),
});
export type FooterStatus = z.infer<typeof footerStatusSchema>;
