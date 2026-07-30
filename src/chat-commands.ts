import { findCommandEntry, runCommandEntry } from "./chat-command-registry";
import type { CommandContext, CommandResult } from "./chat-commands-contract";
import { parseSlashCommand } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { t } from "./i18n";

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  if (!resolvedText.startsWith("/")) return { stop: false, userText: text };
  const parsed = parseSlashCommand(resolvedText);
  const entry = findCommandEntry(parsed.root);
  const running = entry ? runCommandEntry(entry, ctx, parsed) : null;
  if (running) return running;
  ctx.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: text }))]);
  return { stop: true, userText: text };
}
