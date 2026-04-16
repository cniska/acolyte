import { z } from "zod";
import { checklistOutputSchema } from "./checklist-contract";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import { createId } from "./short-id";
import { toolOutputPartSchema } from "./tool-output-contract";

export const roleSchema = z.enum(["system", "user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;
export const messageKindSchema = z.enum(["text", "tool_payload", "status"]);
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

export const chatRowKindSchema = z.enum(["user", "assistant", "tool", "status", "task", "system"]);

export const chatRowStyleSchema = z.object({
  marker: z.string().optional(),
  text: z.string().optional(),
  dim: z.boolean().optional(),
});

export type ChatRowStyle = z.infer<typeof chatRowStyleSchema>;

export const chatRowIdSchema = domainIdSchema("row");
export type ChatRowId = z.infer<typeof chatRowIdSchema>;

export const toolOutputSchema = z.object({
  parts: z.array(toolOutputPartSchema),
});

export type ToolOutput = z.infer<typeof toolOutputSchema>;

export const commandOutputSchema = z.object({
  header: z.string(),
  sections: z.array(z.array(z.tuple([z.string(), z.string()]))),
  list: z.array(z.string()).optional(),
});

export type CommandOutput = z.infer<typeof commandOutputSchema>;

const chatRowContentSchema = z.union([z.string(), toolOutputSchema, commandOutputSchema, checklistOutputSchema]);

export type ChatRowContent = z.infer<typeof chatRowContentSchema>;

export const chatRowSchema = z.object({
  id: chatRowIdSchema,
  kind: chatRowKindSchema,
  content: chatRowContentSchema,
  style: chatRowStyleSchema.optional(),
});

export type ChatRow = z.infer<typeof chatRowSchema>;

export function createRow(kind: ChatRow["kind"], content: ChatRowContent, style?: ChatRowStyle): ChatRow {
  return { id: `row_${createId()}`, kind, content, style: style ?? undefined };
}

export function isToolOutput(content: ChatRowContent | undefined): content is ToolOutput {
  return typeof content === "object" && "parts" in content;
}

export function isCommandOutput(content: ChatRowContent | undefined): content is CommandOutput {
  return typeof content === "object" && "header" in content;
}

export function isChecklistOutput(
  content: ChatRowContent | undefined,
): content is z.infer<typeof checklistOutputSchema> {
  return typeof content === "object" && "groupId" in content;
}
