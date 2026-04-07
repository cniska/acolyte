import { appConfig } from "./app-config";
import type { CommandContext, CommandResult, SlashCommand } from "./chat-commands-contract";
import { createMemoryCommands, resolveMemoryApi } from "./chat-commands-memory";
import { createModelCommands } from "./chat-commands-model";
import { createResumeCommands } from "./chat-commands-resume";
import { sessionsRows } from "./chat-commands-sessions";
import { handleSkillActivation } from "./chat-commands-skill";
import { statusRows } from "./chat-commands-status";
import { usageRows } from "./chat-commands-usage";
import { createWorkspacesCommands } from "./chat-commands-workspaces";
import { createRow } from "./chat-contract";
import { t } from "./i18n";
import { createSession } from "./session-store";

function createSessionsCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "sessions",
    match: (value) => value === "/sessions",
    run: async () => {
      ctx.setRows((current) => [...current, ...sessionsRows(ctx.store, 10)]);
      return { stop: true, userText: ctx.text };
    },
  };
}

function createStatusCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "status",
    match: (value) => value === "/status",
    run: async () => {
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
    },
  };
}

function createUsageCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "usage",
    match: (value) => value === "/usage",
    run: async () => {
      const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
      ctx.setRows((current) => [...current, ...usageRows(last, ctx.tokenUsage)]);
      return { stop: true, userText: ctx.text };
    },
  };
}

function createSkillsCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "skills.panel",
    match: (value) => value === "/skills",
    run: async () => {
      await ctx.openSkillsPanel();
      return { stop: true, userText: ctx.text };
    },
  };
}

function createNewCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "new",
    match: (value) => value === "/new",
    run: async () => {
      const next = createSession(appConfig.model);
      ctx.store.sessions.unshift(next);
      ctx.store.activeSessionId = next.id;
      ctx.setCurrentSession(next);
      ctx.setTokenUsage?.(() => []);
      ctx.clearTranscript(next.id);
      ctx.setValue("");
      ctx.setShowHelp(() => false);
      await ctx.persist();
      return { stop: true, userText: ctx.text };
    },
  };
}

function createExitCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "exit",
    match: (value) => value === "/exit",
    run: async () => {
      await ctx.persist();
      ctx.exit();
      return { stop: true, userText: ctx.text };
    },
  };
}

function createClearCommand(ctx: CommandContext): SlashCommand {
  return {
    name: "clear",
    match: (value) => value === "/clear",
    run: async () => {
      ctx.clearTranscript();
      return { stop: true, userText: ctx.text };
    },
  };
}

function resolveSlashCommands(ctx: CommandContext): SlashCommand[] {
  const memoryApi = resolveMemoryApi(ctx);
  return [
    ...createResumeCommands(ctx),
    createSessionsCommand(ctx),
    ...createWorkspacesCommands(ctx),
    createStatusCommand(ctx),
    ...createModelCommands(ctx),
    ...createMemoryCommands(ctx, memoryApi),
    createUsageCommand(ctx),
    createSkillsCommand(ctx),
    createNewCommand(ctx),
    createExitCommand(ctx),
    createClearCommand(ctx),
  ];
}

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const commands = resolveSlashCommands(ctx);
  for (const command of commands) {
    if (!command.match(resolvedText)) continue;
    return command.run();
  }
  if (resolvedText.startsWith("/")) {
    const skillResult = await handleSkillActivation(ctx);
    if (skillResult) return skillResult;
    ctx.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: text }))]);
    return { stop: true, userText: text };
  }
  return { stop: false, userText: text };
}
