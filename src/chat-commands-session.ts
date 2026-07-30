import { appConfig } from "./app-config";
import type { CommandHandler } from "./chat-commands-contract";
import { createSession } from "./session-store";

export const runNew: CommandHandler = async (ctx) => {
  const next = createSession(appConfig.model);
  ctx.sessionState.sessions.unshift(next);
  ctx.sessionState.activeSessionId = next.id;
  ctx.setCurrentSession(next);
  ctx.setTokenUsage?.(() => []);
  ctx.clearTranscript(next.id);
  ctx.setValue("");
  ctx.setShowHelp(() => false);
  await ctx.persist();
  return { stop: true, userText: ctx.text };
};

export const runClear: CommandHandler = async (ctx) => {
  ctx.clearTranscript();
  return { stop: true, userText: ctx.text };
};

export const runExit: CommandHandler = async (ctx) => {
  await ctx.persist();
  ctx.exit();
  return { stop: true, userText: ctx.text };
};
