import { z } from "zod";
import type { AgentMode } from "./agent-modes";
import { appConfig, setDefaultModel, setModeModel, setPermissionMode } from "./app-config";
import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, formatColumns, formatRelativeTime } from "./chat-format";
import { suggestClosestSlashCommand } from "./chat-slash";
import type { Client } from "./client";
import { setConfigValue } from "./config";
import type { ConfigScope, PermissionMode } from "./config-contract";
import { t } from "./i18n";
import { addMemory, listMemories, type MemoryScope, removeMemoryByPrefix } from "./memory";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { createId } from "./short-id";
import { findSkillByName } from "./skills";

type MemoryContextScope = "all" | "user" | "project";

import type { StatusFields } from "./status-contract";
import { formatStatusOutput } from "./status-format";
import { createSession } from "./storage";

export type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  dim?: boolean;
  style?:
    | "sessionStatus"
    | "sessionsList"
    | "toolProgress"
    | "statusOutput"
    | "tokenOutput"
    | "error"
    | "worked"
    | "cancelled";
  toolCallId?: string;
  toolName?: string;
  toolStatus?: "ok" | "error";
};

export function createRow(
  role: ChatRow["role"],
  content: string,
  options?: { dim?: boolean; style?: ChatRow["style"]; toolCallId?: string; toolName?: string },
): ChatRow {
  return { id: `row_${createId()}`, role, content, ...options };
}

export type TokenUsageEntry = SessionTokenUsageEntry;

export type ResumeResolution =
  | { kind: "usage" }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] }
  | { kind: "ok"; session: Session };

export function resolveResumeSession(store: SessionState, text: string): ResumeResolution {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
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
    const title = item.title || "New Session";
    return [`${active} ${item.id}`, title, formatRelativeTime(item.updatedAt)];
  });
  return formatColumns(rows);
}

export function formatTokenUsageOutput(last: TokenUsageEntry | null, all: TokenUsageEntry[]): string {
  if (!last) return t("tokens.none");
  const totals = all.reduce(
    (acc, entry) => {
      acc.prompt += entry.usage.promptTokens;
      acc.completion += entry.usage.completionTokens;
      acc.total += entry.usage.totalTokens;
      acc.modelCalls += entry.modelCalls ?? 0;
      return acc;
    },
    { prompt: 0, completion: 0, total: 0, modelCalls: 0 },
  );
  const rows: Array<{ key: string; value: string }> = [
    {
      key: t("tokens.label.last_turn"),
      value: `prompt=${last.usage.promptTokens} completion=${last.usage.completionTokens} total=${last.usage.totalTokens}`,
    },
    {
      key: t("tokens.label.session"),
      value: `prompt=${totals.prompt} completion=${totals.completion} total=${totals.total} (${all.length} ${all.length === 1 ? t("tokens.turn.one") : t("tokens.turn.other")})`,
    },
  ];
  if (last.modelCalls !== undefined || totals.modelCalls > 0) {
    rows.push({
      key: t("tokens.label.model_calls"),
      value: `last=${last.modelCalls ?? 0} session=${totals.modelCalls}`,
    });
  }
  if (last.usage.promptBudgetTokens) {
    rows.push({
      key: t("tokens.label.budget"),
      value: `${last.usage.promptTokens}/${last.usage.promptBudgetTokens}${last.usage.promptTruncated ? " (trimmed)" : ""}`,
    });
  }
  const latestWarning = [...all].reverse().find((entry) => Boolean(entry.warning))?.warning;
  if (latestWarning) {
    rows.push({
      key: t("tokens.label.warning"),
      value: latestWarning,
    });
  }
  const maxKey = Math.max(
    COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH,
    rows.reduce((max, row) => Math.max(max, row.key.length), 0),
  );
  return rows.map((row) => `${row.key.padEnd(maxKey, " ")} ${row.value}`).join("\n");
}

export type CommandPresentation = {
  content: string;
  style: ChatRow["style"];
};

export function presentSessionsOutput(store: SessionState, limit = 10): CommandPresentation {
  const recent = formatSessionList(store, limit);
  return {
    content: [t("sessions.header", { count: store.sessions.length }), "", ...recent].join("\n"),
    style: "sessionsList",
  };
}

export function presentStatusOutput(status: StatusFields): CommandPresentation {
  const content = formatStatusOutput(status);
  return {
    content: content.length > 0 ? content : t("status.empty"),
    style: "statusOutput",
  };
}

export function presentTokensOutput(last: TokenUsageEntry | null, all: TokenUsageEntry[]): CommandPresentation {
  return { content: formatTokenUsageOutput(last, all), style: "tokenOutput" };
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
  setTokenUsage?: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  toRows: (messages: Session["messages"]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowHelp: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openModelPanel: (mode?: AgentMode) => void;
  setServerPermissionMode: (mode: PermissionMode) => Promise<void>;
  persistPermissionMode?: (mode: PermissionMode, scope: ConfigScope) => Promise<void>;
  persistModelConfig?: (key: string, value: string, scope: ConfigScope) => Promise<void>;
  activateSkill?: (skillName: string, args: string) => Promise<boolean>;
  tokenUsage: TokenUsageEntry[];
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
  if (scope === "user") return t("scope.user");
  if (scope === "project") return t("scope.project");
  return t("scope.all");
}

function parsePermissionsScope(parts: string[]): ConfigScope | null {
  if (parts.length < 2) return null;
  const flag = parts.find((part) => part === "--project" || part === "--user");
  if (!flag) return "project";
  return flag === "--user" ? "user" : "project";
}

const modelIdSchema = z.string().trim().min(1).regex(/^\S+$/);
const agentModeSchema = z.enum(["plan", "work", "verify", "chat"]);

type ModelSelection =
  | { kind: "default"; model: string }
  | { kind: "mode"; mode: z.infer<typeof agentModeSchema>; model: string };

function parseModelSelectionCommand(resolvedText: string): ModelSelection | null {
  const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
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
  const pushUserCommandRow = (): void => {
    ctx.setRows((current) => [...current, createRow("user", text)]);
  };

  if (resolvedText === "/resume") {
    pushUserCommandRow();
    ctx.openResumePanel();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/resume")) {
    pushUserCommandRow();
    const resolved = resolveResumeSession(ctx.store, resolvedText);
    if (resolved.kind === "usage") {
      const recent = formatSessionList(ctx.store, 6);
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("resume.usage")),
        ...recent.map((line) => createRow("system", line)),
      ]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "not_found") {
      ctx.setRows((current) => [...current, createRow("system", t("resume.not_found", { prefix: resolved.prefix }))]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "ambiguous") {
      const matches = resolved.matches.map((item) => item.id).join(", ");
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("resume.ambiguous", { prefix: resolved.prefix, matches })),
      ]);
      return { stop: true, userText: text };
    }
    const target = resolved.session;
    ctx.store.activeSessionId = target.id;
    ctx.setCurrentSession(target);
    ctx.setTokenUsage?.(() => target.tokenUsage);
    ctx.setRows(() => [
      ...ctx.toRows(target.messages),
      createRow("system", t("resume.resumed", { sessionId: target.id }), { dim: true, style: "sessionStatus" }),
    ]);
    ctx.setShowHelp(() => false);
    await ctx.persist();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/sessions") {
    pushUserCommandRow();
    const rendered = presentSessionsOutput(ctx.store, 10);
    ctx.setRows((current) => [...current, createRow("system", rendered.content, { style: rendered.style })]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/status") {
    pushUserCommandRow();
    try {
      const status = await ctx.client.status();
      const rendered = presentStatusOutput(status);
      ctx.setRows((current) => [...current, createRow("system", rendered.content, { style: rendered.style })]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("status.check_failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/permissions") {
    pushUserCommandRow();
    ctx.openPermissionsPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/model") {
    pushUserCommandRow();
    ctx.openModelPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/model ")) {
    const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length === 2) {
      const mode = agentModeSchema.safeParse(parts[1]);
      if (mode.success) {
        pushUserCommandRow();
        ctx.openModelPanel(mode.data);
        return { stop: true, userText: text };
      }
    }
  }

  if (resolvedText.startsWith("/model ")) {
    pushUserCommandRow();
    const selection = parseModelSelectionCommand(resolvedText);
    if (!selection) {
      ctx.setRows((current) => [...current, createRow("system", t("model.usage"))]);
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
          createRow("system", t("model.changed.mode", { mode: selection.mode, model: selection.model })),
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
        updatedAt: new Date().toISOString(),
      };
      ctx.setCurrentSession(nextSession);
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("model.changed.default", { model: selection.model })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("model.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/permissions ")) {
    pushUserCommandRow();
    const mode = resolvedText.split(/\s+/)[1];
    const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
    const validParts =
      parts.length >= 2 &&
      parts.length <= 3 &&
      parts[0] === "/permissions" &&
      (parts[1] === "read" || parts[1] === "write") &&
      (parts.length === 2 || parts[2] === "--project" || parts[2] === "--user");
    if (!validParts || (mode !== "read" && mode !== "write")) {
      ctx.setRows((current) => [...current, createRow("system", t("permissions.usage"))]);
      return { stop: true, userText: text };
    }
    const scope = parsePermissionsScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, createRow("system", t("permissions.usage"))]);
      return { stop: true, userText: text };
    }
    try {
      await ctx.setServerPermissionMode(mode);
      if (ctx.persistPermissionMode) {
        await ctx.persistPermissionMode(mode, scope);
      } else {
        await setConfigValue("permissionMode", mode, { scope });
      }
      setPermissionMode(mode);
      ctx.setRows((current) => [...current, createRow("system", t("permissions.changed", { mode, scope }))]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("permissions.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/memory rm")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 3) {
      ctx.setRows((current) => [...current, createRow("system", t("memory.rm.usage"))]);
      return { stop: true, userText: text };
    }
    const prefix = parts[2];
    const remove = memoryApi.removeMemoryByPrefix;
    if (!remove) {
      ctx.setRows((current) => [...current, createRow("system", t("memory.rm.unavailable"))]);
      return { stop: true, userText: text };
    }
    try {
      const removed = await remove(prefix);
      if (removed.kind === "not_found") {
        ctx.setRows((current) => [
          ...current,
          createRow("system", t("memory.rm.not_found", { prefix: removed.prefix })),
        ]);
        return { stop: true, userText: text };
      }
      if (removed.kind === "ambiguous") {
        const ids = removed.matches.map((item) => item.id).join(", ");
        ctx.setRows((current) => [
          ...current,
          createRow("system", t("memory.rm.ambiguous", { prefix: removed.prefix, ids })),
        ]);
        return { stop: true, userText: text };
      }
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("memory.rm.removed", { scope: removed.entry.scope, id: removed.entry.id })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : "Failed to remove memory."),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/memory" || resolvedText.startsWith("/memory ")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/);
    const scope = parseMemoryListScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, createRow("system", t("memory.usage"))]);
      return { stop: true, userText: text };
    }
    const memories = await memoryApi.listMemories({ scope });
    if (memories.length === 0) {
      const scopeLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, createRow("system", t("memory.none", { scope: scopeLabel }))]);
      return { stop: true, userText: text };
    }
    const lines = memories.slice(0, 10).map((entry) => `${entry.scope}:${entry.id} ${entry.content}`);
    const header =
      scope === "all"
        ? t("memory.header.all", { count: memories.length })
        : t("memory.header.scope", { scope: scopeLabel(scope), count: memories.length });
    ctx.setRows((current) => [...current, createRow("system", `${header}\n\n${lines.join("\n")}`)]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/tokens") {
    pushUserCommandRow();
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    const rendered = presentTokensOutput(last, ctx.tokenUsage);
    ctx.setRows((current) => [...current, createRow("system", rendered.content, { style: rendered.style })]);
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/remember")) {
    pushUserCommandRow();
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
      ctx.setRows((current) => [...current, createRow("system", t("remember.usage"))]);
      return { stop: true, userText: text };
    }
    try {
      const entry = await memoryApi.addMemory(content, { scope });
      ctx.setRows((current) => [...current, createRow("system", t("remember.saved", { scope: entry.scope, content }))]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("remember.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/skills") {
    pushUserCommandRow();
    await ctx.openSkillsPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/new") {
    const next = createSession(appConfig.model);
    ctx.store.sessions.unshift(next);
    ctx.store.activeSessionId = next.id;
    ctx.setCurrentSession(next);
    ctx.setTokenUsage?.(() => []);
    ctx.setRows(() => [
      createRow("user", text),
      createRow("system", t("session.started", { sessionId: next.id }), { dim: true, style: "sessionStatus" }),
    ]);
    ctx.setValue("");
    ctx.setShowHelp(() => false);
    await ctx.persist();
    return { stop: true, userText: text };
  }

  if (resolvedText === "/exit") {
    pushUserCommandRow();
    await ctx.persist();
    ctx.exit();
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
        pushUserCommandRow();
        ctx.setRows((current) => [...current, createRow("system", t("skill.failed", { skill: skill.name }))]);
        return { stop: true, userText: text };
      }
      if (args) return { stop: false, userText: args };
      pushUserCommandRow();
      ctx.setRows((current) => [...current, createRow("system", t("skill.activated", { skill: skill.name }))]);
      return { stop: true, userText: text };
    }

    const corrected = suggestClosestSlashCommand(head ?? resolvedText);
    if (corrected) {
      const correctedText = rest.length > 0 ? `${corrected} ${rest.join(" ")}` : corrected;
      return dispatchSlashCommand({ ...ctx, text: correctedText, resolvedText: correctedText });
    }
    pushUserCommandRow();
    ctx.setRows((current) => [...current, createRow("system", t("command.unknown", { command: text }))]);
    return { stop: true, userText: text };
  }

  return { stop: false, userText: text };
}
