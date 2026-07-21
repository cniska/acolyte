import { z } from "zod";
import {
  type ChatRow,
  chatRowIdSchema,
  chatRowKindSchema,
  commandOutputSchema,
  toolOutputSchema,
} from "./chat-contract";
import { checklistOutputSchema } from "./checklist-contract";

export const transcriptLifecycleSchema = z.enum([
  "complete",
  "active",
  "pending",
  "queued",
  "success",
  "warning",
  "error",
  "cancelled",
]);
export type TranscriptLifecycle = z.infer<typeof transcriptLifecycleSchema>;
export const transcriptContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string() }),
  z.object({ kind: z.literal("tool-output"), output: toolOutputSchema }),
  z.object({ kind: z.literal("command-output"), output: commandOutputSchema }),
  z.object({ kind: z.literal("checklist"), output: checklistOutputSchema }),
]);
export type TranscriptContent = z.infer<typeof transcriptContentSchema>;
export const transcriptRowSchema = z.object({
  id: chatRowIdSchema,
  kind: chatRowKindSchema,
  lifecycle: transcriptLifecycleSchema,
  content: transcriptContentSchema,
});
export type TranscriptRow = z.infer<typeof transcriptRowSchema>;

export function migrateLegacyChatRow(row: ChatRow): TranscriptRow {
  const lifecycle: TranscriptLifecycle = row.kind === "status" ? "success" : "complete";
  if (typeof row.content === "string")
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "message", text: row.content } };
  if ("parts" in row.content)
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "tool-output", output: row.content } };
  if ("header" in row.content)
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "command-output", output: row.content } };
  return { id: row.id, kind: row.kind, lifecycle, content: { kind: "checklist", output: row.content } };
}
