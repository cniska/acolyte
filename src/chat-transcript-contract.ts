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
  const headerState =
    typeof row.content === "object" && "parts" in row.content
      ? row.content.parts.find((part) => part.kind === "tool-header")?.state
      : undefined;
  const lifecycle: TranscriptLifecycle =
    headerState === "on"
      ? "success"
      : headerState === "off"
        ? "cancelled"
        : (row.style?.outcome ?? (row.kind === "status" ? "success" : "complete"));
  if (typeof row.content === "string")
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "message", text: row.content } };
  if ("parts" in row.content)
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "tool-output", output: row.content } };
  if ("header" in row.content)
    return { id: row.id, kind: row.kind, lifecycle, content: { kind: "command-output", output: row.content } };
  return { id: row.id, kind: row.kind, lifecycle, content: { kind: "checklist", output: row.content } };
}

export function projectActiveTranscript(
  rows: readonly ChatRow[],
  presentation: readonly TranscriptRow[],
): TranscriptRow[] {
  const byId = new Map(presentation.map((row) => [row.id, row]));
  return rows.flatMap((row) => {
    const semanticRow = byId.get(row.id);
    return semanticRow ? [semanticRow] : [];
  });
}

export function legacyChatRowFromTranscript(row: TranscriptRow): ChatRow {
  switch (row.content.kind) {
    case "message":
      return { id: row.id, kind: row.kind, content: row.content.text };
    case "tool-output":
      return { id: row.id, kind: row.kind, content: row.content.output };
    case "command-output":
      return { id: row.id, kind: row.kind, content: row.content.output };
    case "checklist":
      return { id: row.id, kind: row.kind, content: row.content.output };
  }
}
