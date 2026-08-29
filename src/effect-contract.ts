import { z } from "zod";
import { toolOutputPartSchema } from "./tool-output-contract";

/** Nothing chose an effect and nothing waits on it, so it carries its own shape rather than a
 *  tool call's: there is no result coming to settle it. */
export const effectRowSchema = z.object({
  effect: z.string().trim().min(1),
  command: z.string().trim().min(1),
  output: z.array(toolOutputPartSchema),
});

export type EffectRow = z.infer<typeof effectRowSchema>;
