import type { CommandHandler } from "./chat-commands-contract";
import { type ChatRow, createRow } from "./chat-contract";
import { t } from "./i18n";
import type { StatusFields } from "./status-contract";
import { createStatusOutput } from "./status-format";

export function statusRows(status: StatusFields): ChatRow[] {
  const output = createStatusOutput(status);
  if (!output) return [];
  return [createRow("system", output)];
}

export const runStatus: CommandHandler = async (ctx) => {
  try {
    const status = await ctx.client.status();
    ctx.setRows((current) => [...current, ...statusRows(status)]);
  } catch (error) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", error instanceof Error ? error.message : t("chat.status.check_failed")),
    ]);
  }
  return { stop: true, userText: ctx.text };
};
