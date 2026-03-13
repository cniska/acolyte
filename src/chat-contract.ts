import { z } from "zod";
import { domainIdSchema } from "./id-contract";
import { createId } from "./short-id";
import { toolOutputSchema } from "./tool-output-content";

export const chatRowRoleSchema = z.enum(["user", "assistant", "tool", "status", "task", "system"]);

export const chatRowStyleSchema = z.object({
  marker: z.string().optional(),
  text: z.string().optional(),
  dim: z.boolean().optional(),
});

export type ChatRowStyle = z.infer<typeof chatRowStyleSchema>;

export const chatRowIdSchema = domainIdSchema("row");
export type ChatRowId = z.infer<typeof chatRowIdSchema>;

export const chatRowSchema = z.object({
  id: chatRowIdSchema,
  role: chatRowRoleSchema,
  content: z.string(),
  style: chatRowStyleSchema.optional(),
  toolOutput: z.array(toolOutputSchema).optional(),
});

export type ChatRow = z.infer<typeof chatRowSchema>;

export function createRow(role: ChatRow["role"], content: string, style?: ChatRowStyle): ChatRow {
  return { id: `row_${createId()}`, role, content, style: style ?? undefined };
}
