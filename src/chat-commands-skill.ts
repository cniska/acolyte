import type { CommandContext, CommandHandler, CommandResult } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { skillRunPrompt } from "./chat-skill-activator";
import { t } from "./i18n";
import type { SkillMeta } from "./skill-contract";

export const runSkillsPanel: CommandHandler = async (ctx) => {
  await ctx.openSkillsPanel();
  return { stop: true, userText: ctx.text };
};

export function createSkillHandler(skill: SkillMeta): CommandHandler {
  return async (ctx, parsed) => activateSkill(ctx, skill, parsed.args.join(" ").trim());
}

async function activateSkill(ctx: CommandContext, skill: SkillMeta, args: string): Promise<CommandResult> {
  if (!ctx.activateSkill) {
    ctx.setRows((current) => [...current, createRow("system", t("chat.skill.failed", { skill: skill.name }))]);
    return { stop: true, userText: ctx.text };
  }
  const ok = await ctx.activateSkill(skill.name, args);
  if (!ok) {
    ctx.setRows((current) => [...current, createRow("system", t("chat.skill.failed", { skill: skill.name }))]);
    return { stop: true, userText: ctx.text };
  }
  const runPrompt = args || skillRunPrompt(skill.name);
  if (ctx.startAssistantTurn) {
    void ctx.startAssistantTurn(runPrompt);
    return { stop: true, userText: ctx.text };
  }
  return { stop: false, userText: runPrompt };
}
