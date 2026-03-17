import { z } from "zod";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import { createId } from "./short-id";
import { toolOutputPartSchema } from "./tool-output-content";

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

export const chatEntryKindSchema = z.enum(["user", "assistant", "tool", "status", "task", "system"]);

export const chatEntryStyleSchema = z.object({
  marker: z.string().optional(),
  text: z.string().optional(),
  dim: z.boolean().optional(),
});

export type ChatEntryStyle = z.infer<typeof chatEntryStyleSchema>;

export const chatEntryIdSchema = domainIdSchema("row");
export type ChatEntryId = z.infer<typeof chatEntryIdSchema>;

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

const chatEntryContentSchema = z.union([z.string(), toolOutputSchema, commandOutputSchema]);

export type ChatEntryContent = z.infer<typeof chatEntryContentSchema>;

export const chatEntrySchema = z.object({
  id: chatEntryIdSchema,
  kind: chatEntryKindSchema,
  content: chatEntryContentSchema,
  style: chatEntryStyleSchema.optional(),
});

export type ChatEntry = z.infer<typeof chatEntrySchema>;

export function createLine(kind: ChatEntry["kind"], content: ChatEntryContent, style?: ChatEntryStyle): ChatEntry {
  return { id: `row_${createId()}`, kind, content, style: style ?? undefined };
}

export function isToolOutput(content: ChatEntryContent | undefined): content is ToolOutput {
  return typeof content === "object" && "parts" in content;
}

export function isCommandOutput(content: ChatEntryContent | undefined): content is CommandOutput {
  return typeof content === "object" && "header" in content;
}
