import { z } from "zod";
import type { AgentMode } from "./agent-contract";
import { appConfig, setDefaultModel, setModeModel } from "./app-config";
import { formatColumns, formatCompactNumber, formatRelativeTime } from "./chat-format";
import { formatUsage } from "./cli-help";
import type { Client } from "./client-contract";
import { setConfigValue } from "./config";
import type { ConfigScope } from "./config-contract";
import { nowIso } from "./datetime";
import { t } from "./i18n";
import { addMemory, listMemories, removeMemoryByPrefix } from "./memory";
import type { MemoryScope } from "./memory-contract";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { findSkillByName } from "./skills";

type MemoryContextScope = "all" | "user" | "project";

import { type ChatEntry, createLine } from "./chat-contract";
import type { StatusFields } from "./status-contract";
import { createStatusOutput } from "./status-format";
import { createSession } from "./storage";

export type ResumeResolution =
  | { kind: "usage" }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] }
  | { kind: "ok"; session: Session };

export function resolveResumeSession(store: SessionState, text: string): ResumeResolution {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return { kind: "usage" };
  const prefix = parts[1];
  const matches = store.sessions.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) return { kind: "not_found", prefix };
  if (matches.length > 1) return { kind: "ambiguous", prefix, matches };
  return { kind: "ok", session: matches[0] };
}

export function formatSessionList(store: SessionState, limit = 10): string[] {
  const rows = store.sessions.slice(0, limit).map((item) => {
    const active = item.id === store.activeSessionId ? "●" : " ";
    const title = item.title || t("chat.session.default_title");
    return [`${active} ${item.id}`, title, formatRelativeTime(item.updatedAt)];
  });
  return formatColumns(rows);
}

function formatUsageValue(value: number): string {
  return formatCompactNumber(value);
}

function formatShare(tokens: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((tokens / total) * 100)}%`;
}

export function sessionsRows(store: SessionState, limit = 10): ChatEntry[] {
  const list = formatSessionList(store, limit);
  return [
    createLine("system", { header: t("chat.sessions.header", { count: store.sessions.length }), sections: [], list }),
  ];
}

export function statusRows(status: StatusFields): ChatEntry[] {
  const output = createStatusOutput(status);
  if (!output) return [];
  return [createLine("system", output)];
}

export function usageRows(last: SessionTokenUsageEntry | null): ChatEntry[] {
  if (!last) return [createLine("system", t("chat.usage.none"))];
  const summary: [string, string][] = [
    [t("chat.usage.metric.input"), formatUsageValue(last.usage.inputTokens)],
    [t("chat.usage.metric.output"), formatUsageValue(last.usage.outputTokens)],
    [t("chat.usage.metric.total"), formatUsageValue(last.usage.totalTokens)],
  ];
  const breakdown: [string, string][] = [];
  if (last.promptBreakdown) {
    const bd = last.promptBreakdown;
    const total = Math.max(bd.usedTokens, last.usage.inputTokens);
    for (const [label, tokens] of [
      [t("chat.usage.metric.system"), bd.systemTokens],
      [t("chat.usage.metric.tools"), bd.toolTokens],
      [t("chat.usage.metric.memory"), bd.memoryTokens],
      [t("chat.usage.metric.messages"), bd.messageTokens],
    ] as [string, number][]) {
      if (tokens > 0) breakdown.push([label, `${formatUsageValue(tokens)} (${formatShare(tokens, total)})`]);
    }
  }
  const sections: [string, string][][] = [summary];
  if (breakdown.length > 0) sections.push(breakdown);
  return [createLine("system", { header: t("chat.usage.header"), sections })];
}

type CommandResult = {
  stop: boolean;
  userText: string;
};

export type CommandContext = {
  text: string;
  resolvedText: string;
  client: Client;
  store: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  toRows: (messages: Session["messages"]) => ChatEntry[];
  setRows: (updater: (current: ChatEntry[]) => ChatEntry[]) => void;
  setShowHelp: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: (mode?: AgentMode) => void | Promise<void>;
  persistModelConfig?: (key: string, value: string, scope: ConfigScope) => Promise<void>;
  activateSkill?: (skillName: string, args: string) => Promise<boolean>;
  startAssistantTurn?: (userText: string) => Promise<void>;
  clearTranscript: (sessionId?: string) => void;
  tokenUsage: SessionTokenUsageEntry[];
  memoryApi?: {
    listMemories: typeof listMemories;
    addMemory: typeof addMemory;
    removeMemoryByPrefix?: typeof removeMemoryByPrefix;
  };
};

function parseMemoryListScope(parts: string[]): MemoryContextScope | null {
  if (parts.length === 1) return "all";
  if (parts.length !== 2) return null;
  const scope = parts[1];
  if (scope === "all" || scope === "user" || scope === "project") return scope;
  return null;
}

function scopeLabel(scope: MemoryContextScope): string {
  if (scope === "user") return t("chat.scope.user");
  if (scope === "project") return t("chat.scope.project");
  return t("chat.scope.all");
}

const modelIdSchema = z.string().trim().min(1).regex(/^\S+$/);
const agentModeSchema = z.enum(["work", "verify"]);

type ModelSelection =
  | { kind: "default"; model: string }
  | { kind: "mode"; mode: z.infer<typeof agentModeSchema>; model: string };

function parseModelSelectionCommand(resolvedText: string): ModelSelection | null {
  const parts = resolvedText.trim().split(/\s+/);
  if (parts[0] !== "/model") return null;
  if (parts.length === 2) {
    const mode = agentModeSchema.safeParse(parts[1]);
    if (mode.success) return null;
    const parsed = modelIdSchema.safeParse(parts[1]);
    if (!parsed.success) return null;
    return { kind: "default", model: parsed.data };
  }
  if (parts.length === 3) {
    const mode = agentModeSchema.safeParse(parts[1]);
    if (!mode.success) return null;
    const parsed = modelIdSchema.safeParse(parts[2]);
    if (!parsed.success) return null;
    return { kind: "mode", mode: mode.data, model: parsed.data };
  }
  return null;
}

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const memoryApi = {
    listMemories,
    addMemory,
    removeMemoryByPrefix,
    ...ctx.memoryApi,
  };

  if (resolvedText === "/resume") {
    ctx.openResumePanel();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/resume")) {
    const resolved = resolveResumeSession(ctx.store, resolvedText);
    if (resolved.kind === "usage") {
      const recent = formatSessionList(ctx.store, 6);
      ctx.setRows((current) => [
        ...current,
        createLine("system", formatUsage("/resume <session-id-prefix>")),
        ...recent.map((line) => createLine("system", line)),
      ]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "not_found") {
      ctx.setRows((current) => [
        ...current,
        createLine("system", t("chat.resume.not_found", { prefix: resolved.prefix })),
      ]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "ambiguous") {
      const matches = resolved.matches.map((item) => item.id).join(", ");
      ctx.setRows((current) => [
        ...current,
        createLine("system", t("chat.resume.ambiguous", { prefix: resolved.prefix, matches })),
      ]);
      return { stop: true, userText: text };
    }
    const target = resolved.session;
    ctx.store.activeSessionId = target.id;
    ctx.setCurrentSession(target);
    ctx.setTokenUsage?.(() => target.tokenUsage);
    ctx.clearTranscript(target.id);
    ctx.setRows(() => ctx.toRows(target.messages));
    ctx.setShowHelp(() => false);
    await ctx.persist();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/sessions") {
    ctx.setRows((current) => [...current, ...sessionsRows(ctx.store, 10)]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/status") {
    try {
      const status = await ctx.client.status();
      ctx.setRows((current) => [...current, ...statusRows(status)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", error instanceof Error ? error.message : t("chat.status.check_failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/model") {
    ctx.openModelPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/model ")) {
    const parts = resolvedText.trim().split(/\s+/);
    if (parts.length === 2) {
      const mode = agentModeSchema.safeParse(parts[1]);
      if (mode.success) {
        ctx.openModelPanel(mode.data);
        return { stop: true, userText: text };
      }
    }

    const selection = parseModelSelectionCommand(resolvedText);
    if (!selection) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", formatUsage("/model <id> | /model <work|verify> <id>")),
      ]);
      return { stop: true, userText: text };
    }
    try {
      if (selection.kind === "mode") {
        const key = `models.${selection.mode}`;
        if (ctx.persistModelConfig) {
          await ctx.persistModelConfig(key, selection.model, "project");
        } else {
          await setConfigValue(key, selection.model, { scope: "project" });
        }
        setModeModel(selection.mode, selection.model);
        ctx.setRows((current) => [
          ...current,
          createLine(
            "system",
            t("chat.model.changed.mode", { mode: selection.mode, model: formatModel(selection.model) }),
          ),
        ]);
        return { stop: true, userText: text };
      }
      if (ctx.persistModelConfig) {
        await ctx.persistModelConfig("model", selection.model, "project");
      } else {
        await setConfigValue("model", selection.model, { scope: "project" });
      }
      setDefaultModel(selection.model);
      const nextSession: Session = {
        ...ctx.currentSession,
        model: selection.model,
        updatedAt: nowIso(),
      };
      ctx.setCurrentSession(nextSession);
      ctx.setRows((current) => [
        ...current,
        createLine("system", t("chat.model.changed.default", { model: formatModel(selection.model) })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", error instanceof Error ? error.message : t("chat.model.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/memory rm")) {
    const parts = resolvedText.trim().split(/\s+/);
    if (parts.length !== 3) {
      ctx.setRows((current) => [...current, createLine("system", formatUsage("/memory rm <id-prefix>"))]);
      return { stop: true, userText: text };
    }
    const prefix = parts[2];
    const remove = memoryApi.removeMemoryByPrefix;
    if (!remove) {
      ctx.setRows((current) => [...current, createLine("system", t("chat.memory.rm.unavailable"))]);
      return { stop: true, userText: text };
    }
    try {
      const removed = await remove(prefix);
      if (removed.kind === "not_found") {
        ctx.setRows((current) => [
          ...current,
          createLine("system", t("chat.memory.rm.not_found", { prefix: removed.prefix })),
        ]);
        return { stop: true, userText: text };
      }
      if (removed.kind === "ambiguous") {
        const ids = removed.matches.map((item) => item.id).join(", ");
        ctx.setRows((current) => [
          ...current,
          createLine("system", t("chat.memory.rm.ambiguous", { prefix: removed.prefix, ids })),
        ]);
        return { stop: true, userText: text };
      }
      ctx.setRows((current) => [
        ...current,
        createLine("system", t("chat.memory.rm.removed", { scope: removed.entry.scope, id: removed.entry.id })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", error instanceof Error ? error.message : t("chat.memory.rm.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/memory" || resolvedText.startsWith("/memory ")) {
    const parts = resolvedText.split(/\s+/);
    const scope = parseMemoryListScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, createLine("system", formatUsage("/memory [all|user|project]"))]);
      return { stop: true, userText: text };
    }
    const memories = await memoryApi.listMemories({ scope });
    if (memories.length === 0) {
      const emptyLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, createLine("system", t("chat.memory.none", { scope: emptyLabel }))]);
      return { stop: true, userText: text };
    }
    const list = memories.slice(0, 10).map((entry) => `${entry.scope}:${entry.id} ${entry.content}`);
    const header =
      scope === "all"
        ? t("chat.memory.header.all", { count: memories.length })
        : t("chat.memory.header.scope", { scope: scopeLabel(scope), count: memories.length });
    ctx.setRows((current) => [...current, createLine("system", { header, sections: [], list })]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/usage") {
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    ctx.setRows((current) => [...current, ...usageRows(last)]);
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/remember")) {
    const parts = resolvedText.split(/\s+/).slice(1);
    let scope: MemoryScope = "user";
    const contentParts: string[] = [];
    for (const part of parts) {
      if (part === "--project") {
        scope = "project";
        continue;
      }
      if (part === "--user") {
        scope = "user";
        continue;
      }
      contentParts.push(part);
    }
    const content = contentParts.join(" ").trim();
    if (!content) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", formatUsage("/remember [--user|--project] <memory text>")),
      ]);
      return { stop: true, userText: text };
    }
    try {
      const entry = await memoryApi.addMemory(content, { scope });
      ctx.setRows((current) => [
        ...current,
        createLine("system", t("chat.remember.saved", { scope: entry.scope, content })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createLine("system", error instanceof Error ? error.message : t("chat.remember.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/skills") {
    await ctx.openSkillsPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/new") {
    const next = createSession(appConfig.model);
    ctx.store.sessions.unshift(next);
    ctx.store.activeSessionId = next.id;
    ctx.setCurrentSession(next);
    ctx.setTokenUsage?.(() => []);
    ctx.clearTranscript(next.id);
    ctx.setValue("");
    ctx.setShowHelp(() => false);
    await ctx.persist();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/exit") {
    await ctx.persist();
    ctx.exit();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/clear") {
    ctx.clearTranscript();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/")) {
    const [head, ...rest] = resolvedText.split(/\s+/);
    const skillName = (head ?? "").slice(1);
    const skill = findSkillByName(skillName);
    if (skill && ctx.activateSkill) {
      const args = rest.join(" ").trim();
      const ok = await ctx.activateSkill(skill.name, args);
      if (!ok) {
        ctx.setRows((current) => [...current, createLine("system", t("chat.skill.failed", { skill: skill.name }))]);
        return { stop: true, userText: text };
      }
      const runPrompt = args || t("chat.skill.run_prompt", { skill: skill.name });
      if (ctx.startAssistantTurn) {
        void ctx.startAssistantTurn(runPrompt);
        return { stop: true, userText: text };
      }
      return { stop: false, userText: runPrompt };
    }

    ctx.setRows((current) => [...current, createLine("system", t("chat.command.unknown", { command: text }))]);
    return { stop: true, userText: text };
  }

  return { stop: false, userText: text };
}
