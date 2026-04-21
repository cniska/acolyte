import { z } from "zod";

export const prStateSchema = z
  .enum(["OPEN", "MERGED", "CLOSED"])
  .transform((v) => v.toLowerCase() as "open" | "merged" | "closed");
export type PrState = z.infer<typeof prStateSchema>;

export const prInfoSchema = z.object({
  number: z.number().int(),
  state: prStateSchema,
  title: z.string(),
  url: z.string(),
});
export type PrInfo = z.infer<typeof prInfoSchema>;

export const createResultSchema = z.object({
  number: z.number().int(),
  url: z.string(),
});
export type CreateResult = z.infer<typeof createResultSchema>;

export const issueInfoSchema = z.object({
  number: z.number().int(),
  state: z.string(),
  title: z.string(),
});
export type IssueInfo = z.infer<typeof issueInfoSchema>;

export const issueListSchema = z.array(issueInfoSchema);
