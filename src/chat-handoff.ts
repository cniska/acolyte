import { z } from "zod";
import { createRow } from "./chat-contract";
import type { Client } from "./client-contract";
import type { Session } from "./session-contract";

export const handoffRequestSchema = z
  .object({
    kind: z.literal("session-handoff"),
    requested: z.literal(true),
    reason: z.string().min(1).optional(),
  })
  .strict();

export type HandoffRequest = z.infer<typeof handoffRequestSchema>;

export const HANDOFF_SUMMARY_PROMPT = [
  "Write a concise session handoff summary for the next agent.",
  "Use exactly this structure:",
  "# Session summary - <branch or topic>",
  "",
  "## What was built",
  "- ...",
  "",
  "## Design decisions",
  "- ...",
  "",
  "## What's next",
  "- ...",
  "",
  "Guidelines:",
  "- Keep it short but complete.",
  "- Include the main files, commands, and decisions that matter for continuation.",
  "- Mention any unresolved risks or follow-ups explicitly.",
  "- Do not invent details.",
].join("\n");

export function createHandoffPrompt(session: Session, reason?: string): string {
  const parts = [HANDOFF_SUMMARY_PROMPT];
  parts.push("");
  parts.push(`Current session title: ${session.title}`);
  parts.push(`Workspace branch: ${session.workspaceBranch ?? "unknown"}`);
  if (reason && reason.trim().length > 0) parts.push(`Handoff reason: ${reason.trim()}`);
  return parts.join("\n");
}

export async function generateHandoffSummary(input: {
  client: Client;
  session: Session;
  reason?: string;
}): Promise<string> {
  const reply = await input.client.replyStream({
    request: {
      message: createHandoffPrompt(input.session, input.reason),
      history: input.session.messages,
      model: input.session.model,
      sessionId: input.session.id,
      workspace: input.session.workspace,
    },
    onEvent: () => {},
  });
  const summary = reply.output.trim();
  if (summary.length === 0) {
    throw new Error("Handoff summary generation returned no output.");
  }
  return summary;
}

export function summaryTitle(summary: string): string | null {
  const match = summary.match(/^# Session summary - (.+)$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : null;
}

export function createSummaryRow(summary: string) {
  return createRow("system", summary);
}
