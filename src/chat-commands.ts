import { appConfig, setPermissionMode } from "./app-config";
import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, formatColumns, formatRelativeTime } from "./chat-format";
import { suggestClosestSlashCommand } from "./chat-slash";
import type { Client } from "./client";
import { setConfigValue } from "./config";
import type { ConfigScope, PermissionMode } from "./config-modes";
import { addMemory, listMemories, type MemoryScope, removeMemoryByPrefix } from "./memory";
import { createId } from "./short-id";
import { findSkillByName } from "./skills";
import type { MemoryContextScope } from "./soul";
import { formatStatusOutput } from "./status-format";
import { createSession } from "./storage";
import type { Session, SessionStore, SessionTokenUsageEntry } from "./types";

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

export function resolveResumeSession(store: SessionStore, text: string): ResumeResolution {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) return { kind: "usage" };
  const prefix = parts[1];
  const matches = store.sessions.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) return { kind: "not_found", prefix };
  if (matches.length > 1) return { kind: "ambiguous", prefix, matches };
  return { kind: "ok", session: matches[0] };
}

export function formatSessionList(store: SessionStore, limit = 10): string[] {
  const rows = store.sessions.slice(0, limit).map((item) => {
    const active = item.id === store.activeSessionId ? "●" : " ";
    const title = item.title || "New Session";
    return [`${active} ${item.id}`, title, formatRelativeTime(item.updatedAt)];
  });
  return formatColumns(rows);
}

export function formatTokenUsageOutput(last: TokenUsageEntry | null, all: TokenUsageEntry[]): string {
  if (!last) return "No token data yet. Send a prompt first.";
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
      key: "last_turn:",
      value: `prompt=${last.usage.promptTokens} completion=${last.usage.completionTokens} total=${last.usage.totalTokens}`,
    },
    {
      key: "session:",
      value: `prompt=${totals.prompt} completion=${totals.completion} total=${totals.total} (${all.length} ${all.length === 1 ? "turn" : "turns"})`,
    },
  ];
  if (last.modelCalls !== undefined || totals.modelCalls > 0) {
    rows.push({
      key: "model_calls:",
      value: `last=${last.modelCalls ?? 0} session=${totals.modelCalls}`,
    });
  }
  if (last.usage.promptBudgetTokens) {
    rows.push({
      key: "budget:",
      value: `${last.usage.promptTokens}/${last.usage.promptBudgetTokens}${last.usage.promptTruncated ? " (trimmed)" : ""}`,
    });
  }
  const latestWarning = [...all].reverse().find((entry) => Boolean(entry.warning))?.warning;
  if (latestWarning) {
    rows.push({
      key: "warning:",
      value: latestWarning,
    });
  }
  const maxKey = Math.max(COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, rows.reduce((max, row) => Math.max(max, row.key.length), 0));
  return rows.map((row) => `${row.key.padEnd(maxKey, " ")} ${row.value}`).join("\n");
}

export type CommandPresentation = {
  content: string;
  style: ChatRow["style"];
};

export function presentSessionsOutput(store: SessionStore, limit = 10): CommandPresentation {
  const recent = formatSessionList(store, limit);
  return {
    content: [`Sessions ${store.sessions.length}`, "", ...recent].join("\n"),
    style: "sessionsList",
  };
}

export function presentStatusOutput(status: Record<string, string>): CommandPresentation {
  return {
    content: formatStatusOutput(status),
    style: "statusOutput",
  };
}

export function presentTokensOutput(last: TokenUsageEntry | null, all: TokenUsageEntry[]): CommandPresentation {
  return {
    content: formatTokenUsageOutput(last, all),
    style: "tokenOutput",
  };
}

type CommandResult = {
  stop: boolean;
  userText: string;
};

export type CommandContext = {
  text: string;
  resolvedText: string;
  client: Client;
  store: SessionStore;
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
  setServerPermissionMode: (mode: PermissionMode) => Promise<void>;
  persistPermissionMode?: (mode: PermissionMode, scope: ConfigScope) => Promise<void>;
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
  if (scope === "user") return "User";
  if (scope === "project") return "Project";
  return "All";
}

function parsePermissionsScope(parts: string[]): ConfigScope | null {
  if (parts.length < 2) return null;
  const flag = parts.find((part) => part === "--project" || part === "--user");
  if (!flag) return "project";
  return flag === "--user" ? "user" : "project";
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
        createRow("system", "Usage: /resume <session-id-prefix>"),
        ...recent.map((line) => createRow("system", line)),
      ]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "not_found") {
      ctx.setRows((current) => [...current, createRow("system", `No session found for prefix: ${resolved.prefix}`)]);
      return { stop: true, userText: text };
    }
    if (resolved.kind === "ambiguous") {
      ctx.setRows((current) => [
        ...current,
        createRow(
          "system",
          `Ambiguous prefix: ${resolved.prefix}. Matches: ${resolved.matches.map((item) => item.id).join(", ")}`,
        ),
      ]);
      return { stop: true, userText: text };
    }
    const target = resolved.session;
    ctx.store.activeSessionId = target.id;
    ctx.setCurrentSession(target);
    ctx.setTokenUsage?.(() => target.tokenUsage);
    ctx.setRows(() => [
      ...ctx.toRows(target.messages),
      createRow("system", `Resumed session: ${target.id}`, { dim: true, style: "sessionStatus" }),
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
      ctx.setRows((current) => [
        ...current,
        createRow("system", rendered.content, { style: rendered.style }),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : "Status check failed."),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/permissions") {
    pushUserCommandRow();
    ctx.openPermissionsPanel();
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
      ctx.setRows((current) => [
        ...current,
        createRow("system", "Usage: /permissions [read|write] [--project|--user]"),
      ]);
      return { stop: true, userText: text };
    }
    const scope = parsePermissionsScope(parts);
    if (!scope) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", "Usage: /permissions [read|write] [--project|--user]"),
      ]);
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
      ctx.setRows((current) => [...current, createRow("system", `Changed permissions to ${mode} (${scope}).`)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : "Failed to set permission mode."),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/memory rm")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 3) {
      ctx.setRows((current) => [...current, createRow("system", "Usage: /memory rm <id-prefix>")]);
      return { stop: true, userText: text };
    }
    const prefix = parts[2];
    const remove = memoryApi.removeMemoryByPrefix;
    if (!remove) {
      ctx.setRows((current) => [...current, createRow("system", "Memory removal is unavailable in this context.")]);
      return { stop: true, userText: text };
    }
    try {
      const removed = await remove(prefix);
      if (removed.kind === "not_found") {
        ctx.setRows((current) => [...current, createRow("system", `No memory found for id prefix: ${removed.prefix}`)]);
        return { stop: true, userText: text };
      }
      if (removed.kind === "ambiguous") {
        const ids = removed.matches.map((item) => item.id).join(", ");
        ctx.setRows((current) => [
          ...current,
          createRow("system", `Ambiguous memory id prefix: ${removed.prefix}. Matches: ${ids}`),
        ]);
        return { stop: true, userText: text };
      }
      ctx.setRows((current) => [
        ...current,
        createRow("system", `Removed ${removed.entry.scope} memory ${removed.entry.id}.`),
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
      ctx.setRows((current) => [...current, createRow("system", "Usage: /memory [all|user|project]")]);
      return { stop: true, userText: text };
    }
    const memories = await memoryApi.listMemories({ scope });
    if (memories.length === 0) {
      const scopeLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, createRow("system", `No ${scopeLabel}memory saved yet.`)]);
      return { stop: true, userText: text };
    }
    const lines = memories.slice(0, 10).map((entry) => `${entry.scope}:${entry.id} ${entry.content}`);
    const header = scope === "all" ? `Memory ${memories.length}` : `${scopeLabel(scope)} memory ${memories.length}`;
    ctx.setRows((current) => [...current, createRow("system", `${header}\n\n${lines.join("\n")}`)]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/tokens") {
    pushUserCommandRow();
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    const rendered = presentTokensOutput(last, ctx.tokenUsage);
    ctx.setRows((current) => [
      ...current,
      createRow("system", rendered.content, { style: rendered.style }),
    ]);
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
      ctx.setRows((current) => [...current, createRow("system", "Usage: /remember [--user|--project] <memory text>")]);
      return { stop: true, userText: text };
    }
    try {
      const entry = await memoryApi.addMemory(content, { scope });
      ctx.setRows((current) => [...current, createRow("system", `Saved ${entry.scope} memory: ${content}`)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : "Failed to save memory."),
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
      createRow("system", `Started new session: ${next.id}`, { dim: true, style: "sessionStatus" }),
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
        ctx.setRows((current) => [...current, createRow("system", `Failed to activate skill: ${skill.name}`)]);
        return { stop: true, userText: text };
      }
      if (args) return { stop: false, userText: args };
      pushUserCommandRow();
      ctx.setRows((current) => [...current, createRow("system", `Activated skill: ${skill.name}`)]);
      return { stop: true, userText: text };
    }

    const corrected = suggestClosestSlashCommand(head ?? resolvedText);
    if (corrected) {
      const correctedText = rest.length > 0 ? `${corrected} ${rest.join(" ")}` : corrected;
      return dispatchSlashCommand({ ...ctx, text: correctedText, resolvedText: correctedText });
    }
    pushUserCommandRow();
    ctx.setRows((current) => [...current, createRow("system", `Unknown command: ${text}`)]);
    return { stop: true, userText: text };
  }

  return { stop: false, userText: text };
}
