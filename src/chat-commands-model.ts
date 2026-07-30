import { z } from "zod";
import { setModel } from "./app-config";
import { MODEL_SPEC, rootUsage } from "./chat-command-specs";
import type { CommandContext, CommandHandler, CommandResult } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { formatUsage } from "./cli-help";
import { setConfigValue } from "./config";
import { nowIso } from "./datetime";
import { t } from "./i18n";
import { formatModel } from "./provider-config";
import type { Session } from "./session-contract";

const modelIdSchema = z.string().trim().min(1).regex(/^\S+$/);

function parseModelCommand(resolvedText: string): string | null {
  const parts = resolvedText.trim().split(/\s+/);
  if (parts[0] !== "/model" || parts.length !== 2) return null;
  const parsed = modelIdSchema.safeParse(parts[1]);
  return parsed.success ? parsed.data : null;
}

async function handleModelPanel(ctx: CommandContext): Promise<CommandResult> {
  ctx.openModelPanel();
  return { stop: true, userText: ctx.text };
}

async function handleModelSet(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const model = parseModelCommand(resolvedText);
  if (!model) {
    ctx.setRows((current) => [...current, createRow("system", formatUsage(rootUsage(MODEL_SPEC)))]);
    return { stop: true, userText: text };
  }
  try {
    if (ctx.persistModelConfig) {
      await ctx.persistModelConfig("model", model, "project");
    } else {
      await setConfigValue("model", model, { scope: "project" });
    }
    setModel(model);
    const nextSession: Session = {
      ...ctx.currentSession,
      model,
      updatedAt: nowIso(),
    };
    ctx.setCurrentSession(nextSession);
    await ctx.persist();
    ctx.setRows((current) => [...current, createRow("system", t("chat.model.changed", { model: formatModel(model) }))]);
  } catch (error) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", error instanceof Error ? error.message : t("chat.model.failed")),
    ]);
  }
  return { stop: true, userText: text };
}

export const runModel: CommandHandler = (ctx, parsed) =>
  parsed.args.length === 0 ? handleModelPanel(ctx) : handleModelSet(ctx);
