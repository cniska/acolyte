import { z } from "zod";
import { type IsoDateTimeString, isoDateTimeSchema } from "./datetime";

export const roleSchema = z.enum(["system", "user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  role: roleSchema,
  content: z.string(),
  timestamp: isoDateTimeSchema,
});

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: IsoDateTimeString;
}
