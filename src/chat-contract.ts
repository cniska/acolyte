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

export const chatLineRoleSchema = z.enum(["user", "assistant", "tool", "status", "task", "system"]);

export const chatLineStyleSchema = z.object({
  marker: z.string().optional(),
  text: z.string().optional(),
  dim: z.boolean().optional(),
});

export type ChatLineStyle = z.infer<typeof chatLineStyleSchema>;

export const chatLineIdSchema = domainIdSchema("row");
export type ChatLineId = z.infer<typeof chatLineIdSchema>;

export const commandOutputSchema = z.object({
  header: z.string(),
  sections: z.array(z.array(z.tuple([z.string(), z.string()]))),
  list: z.array(z.string()).optional(),
});

export type CommandOutput = z.infer<typeof commandOutputSchema>;

export const chatLineSchema = z.object({
  id: chatLineIdSchema,
  role: chatLineRoleSchema,
  content: z.string(),
  style: chatLineStyleSchema.optional(),
  toolOutput: z.array(toolOutputSchema).optional(),
  commandOutput: commandOutputSchema.optional(),
});

export type ChatLine = z.infer<typeof chatLineSchema>;

export function createLine(role: ChatLine["role"], content: string, style?: ChatLineStyle): ChatLine {
  return { id: `row_${createId()}`, role, content, style: style ?? undefined };
}
