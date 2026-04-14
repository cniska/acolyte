import type { CommandContext, CommandResult, SlashCommand } from "./chat-commands-contract";
import { formatSessionList } from "./chat-commands-sessions";
import { type ChatRow, createRow } from "./chat-contract";
import { formatUsage } from "./cli-help";
import { t } from "./i18n";
import type { Session, SessionState } from "./session-contract";

export type ResumeResolution =
  | { kind: "usage" }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] }
  | { kind: "ok"; session: Session };

export function resolveResumeSession(sessionState: SessionState, text: string): ResumeResolution {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return { kind: "usage" };
  const prefix = parts[1];
  const matches = sessionState.sessions.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) return { kind: "not_found", prefix };
  if (matches.length > 1) return { kind: "ambiguous", prefix, matches };
  return { kind: "ok", session: matches[0] };
}

function resumeUsageRows(sessionState: SessionState): ChatRow[] {
  const recent = formatSessionList(sessionState, 6);
  return [
    createRow("system", formatUsage("/resume <session-id-prefix>")),
    ...recent.map((line) => createRow("system", line)),
  ];
}

async function handleResumePanel(ctx: CommandContext): Promise<CommandResult> {
  ctx.openResumePanel();
  return { stop: true, userText: ctx.text };
}

async function handleResume(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const resolved = resolveResumeSession(ctx.sessionState, resolvedText);
  if (resolved.kind === "usage") {
    ctx.setRows((current) => [...current, ...resumeUsageRows(ctx.sessionState)]);
    return { stop: true, userText: text };
  }
  if (resolved.kind === "not_found") {
    ctx.setRows((current) => [
      ...current,
      createRow("system", t("chat.resume.not_found", { prefix: resolved.prefix })),
    ]);
    return { stop: true, userText: text };
  }
  if (resolved.kind === "ambiguous") {
    const matches = resolved.matches.map((item) => item.id).join(", ");
    ctx.setRows((current) => [
      ...current,
      createRow("system", t("chat.resume.ambiguous", { prefix: resolved.prefix, matches })),
    ]);
    return { stop: true, userText: text };
  }
  const target = resolved.session;
  if (target.id === ctx.sessionState.activeSessionId) return { stop: true, userText: text };
  ctx.sessionState.activeSessionId = target.id;
  ctx.setCurrentSession(target);
  ctx.setTokenUsage?.(() => target.tokenUsage);
  ctx.clearTranscript(target.id);
  ctx.setRows(() => ctx.toRows(target.messages));
  ctx.setShowHelp(() => false);
  await ctx.persist();
  return { stop: true, userText: text };
}

export function createResumeCommands(ctx: CommandContext): SlashCommand[] {
  return [
    { name: "resume.panel", match: (value) => value === "/resume", run: () => handleResumePanel(ctx) },
    { name: "resume", match: (value) => value.startsWith("/resume"), run: () => handleResume(ctx) },
  ];
}
