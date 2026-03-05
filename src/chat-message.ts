import { z } from "zod";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

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

export interface Message {
  readonly id: MessageId;
  readonly role: Role;
  content: string;
  readonly kind?: MessageKind;
  readonly timestamp: IsoDateTimeString;
}
