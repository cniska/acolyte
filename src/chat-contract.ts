import { z } from "zod";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import { createId } from "./short-id";
import { toolOutputSchema } from "./tool-output-content";

export const roleSchema = z.enum(["system", "user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;
export const messageKindSchema = z.enum(["text", "tool_payload"]);
export type MessageKind = z.infer<typeof messageKindSchema>;
export const messageIdSchema = domainIdSchema("msg");
export type MessageId = z.infer<typeof messageIdSchema>;

export const messageSchema = z.object({
  id: messageIdSchema,
  role: roleSchema,
  content: z.string(),
  kind: messageKindSchema.default("text"),
  timestamp: isoDateTimeSchema,
});

export type ChatMessage = z.input<typeof messageSchema>;

export const chatRowRoleSchema = z.enum(["user", "assistant", "tool", "status", "task", "system"]);

export const chatRowStyleSchema = z.object({
  marker: z.string().optional(),
  text: z.string().optional(),
  dim: z.boolean().optional(),
});

export type ChatRowStyle = z.infer<typeof chatRowStyleSchema>;

export const chatRowIdSchema = domainIdSchema("row");
export type ChatRowId = z.infer<typeof chatRowIdSchema>;

export const commandOutputSchema = z.object({
  header: z.string(),
  sections: z.array(z.array(z.tuple([z.string(), z.string()]))),
});

export type CommandOutput = z.infer<typeof commandOutputSchema>;

export const chatRowSchema = z.object({
  id: chatRowIdSchema,
  role: chatRowRoleSchema,
  content: z.string(),
  style: chatRowStyleSchema.optional(),
  toolOutput: z.array(toolOutputSchema).optional(),
  commandOutput: commandOutputSchema.optional(),
});

export type ChatRow = z.infer<typeof chatRowSchema>;

export function createRow(role: ChatRow["role"], content: string, style?: ChatRowStyle): ChatRow {
  return { id: `row_${createId()}`, role, content, style: style ?? undefined };
}
