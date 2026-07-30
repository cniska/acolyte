import { findCommandEntry, runCommandEntry } from "./chat-command-registry";
import type { CommandContext, CommandResult } from "./chat-commands-contract";
import { parseSlashCommand } from "./chat-commands-contract";
import { handleSkillActivation } from "./chat-commands-skill";
import { createRow } from "./chat-contract";
import { t } from "./i18n";

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  if (!resolvedText.startsWith("/")) return { stop: false, userText: text };
  const parsed = parseSlashCommand(resolvedText);
  const entry = findCommandEntry(parsed.root);
  if (entry) return runCommandEntry(entry, ctx, parsed);
  const skillResult = await handleSkillActivation(ctx);
  if (skillResult) return skillResult;
  ctx.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: text }))]);
  return { stop: true, userText: text };
}
