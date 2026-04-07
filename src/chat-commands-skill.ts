import type { CommandContext, CommandResult, SlashCommand } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { t } from "./i18n";
import { findSkillByName } from "./skills";

async function handleSkillActivation(ctx: CommandContext): Promise<CommandResult | null> {
  if (!ctx.activateSkill) return null;
  const [head, ...rest] = ctx.resolvedText.split(/\s+/);
  const skillName = (head ?? "").slice(1);
  const skill = findSkillByName(skillName);
  if (!skill) return null;
  const args = rest.join(" ").trim();
  const ok = await ctx.activateSkill(skill.name, args);
  if (!ok) {
    ctx.setRows((current) => [...current, createRow("system", t("chat.skill.failed", { skill: skill.name }))]);
    return { stop: true, userText: ctx.text };
  }
  const runPrompt = args || t("chat.skill.run_prompt", { skill: skill.name });
  if (ctx.startAssistantTurn) {
    void ctx.startAssistantTurn(runPrompt);
    return { stop: true, userText: ctx.text };
  }
  return { stop: false, userText: runPrompt };
}

async function handleUnknownSlash(ctx: CommandContext): Promise<CommandResult> {
  ctx.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: ctx.text }))]);
  return { stop: true, userText: ctx.text };
}

export function createSkillCommands(ctx: CommandContext): SlashCommand[] {
  return [
    {
      name: "skill.or.unknown",
      match: (value) => value.startsWith("/"),
      run: async () => {
        const handled = await handleSkillActivation(ctx);
        if (handled) return handled;
        return handleUnknownSlash(ctx);
      },
    },
  ];
}
