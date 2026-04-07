import { z } from "zod";
import { appConfig, setModel } from "./app-config";
import { alignCols, formatCompactNumber } from "./chat-format";
import { formatUsage } from "./cli-help";
import type { Client } from "./client-contract";
import { setConfigValue } from "./config";
import type { ConfigScope } from "./config-contract";
import { formatRelativeTime, nowIso } from "./datetime";
import { t } from "./i18n";
import type { MemoryScope } from "./memory-contract";
import { addMemory, listMemories, removeMemory } from "./memory-ops";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { findSkillByName } from "./skills";
import { createGitWorktree, resolveGitRepoRoot, suggestWorkspaceName, workspaceNameSchema } from "./workspaces-ops";

type MemoryContextScope = "all" | "user" | "project";

import { type ChatRow, createRow } from "./chat-contract";
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
  return alignCols(rows);
}

function formatUsageValue(value: number): string {
  return formatCompactNumber(value);
}

function formatShare(tokens: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((tokens / total) * 100)}%`;
}

export function sessionsRows(store: SessionState, limit = 10): ChatRow[] {
  const list = formatSessionList(store, limit);
  return [
    createRow("system", { header: t("chat.sessions.header", { count: store.sessions.length }), sections: [], list }),
  ];
}

export function statusRows(status: StatusFields): ChatRow[] {
  const output = createStatusOutput(status);
  if (!output) return [];
  return [createRow("system", output)];
}

export function usageRows(last: SessionTokenUsageEntry | null, all: SessionTokenUsageEntry[] = []): ChatRow[] {
  if (!last) return [createRow("system", t("chat.usage.none"))];
  const totals = all.reduce(
    (acc, entry) => {
      acc.input += entry.usage.inputTokens;
      acc.output += entry.usage.outputTokens;
      acc.total += entry.usage.totalTokens;
      return acc;
    },
    { input: 0, output: 0, total: 0 },
  );
  const hasSession = all.length > 1;
  const summaryGrid: string[][] = [
    hasSession
      ? [formatUsageValue(last.usage.inputTokens), formatUsageValue(totals.input)]
      : [formatUsageValue(last.usage.inputTokens)],
    hasSession
      ? [formatUsageValue(last.usage.outputTokens), formatUsageValue(totals.output)]
      : [formatUsageValue(last.usage.outputTokens)],
    hasSession
      ? [formatUsageValue(last.usage.totalTokens), formatUsageValue(totals.total)]
      : [formatUsageValue(last.usage.totalTokens)],
  ];
  const summaryLabels = [t("chat.usage.metric.input"), t("chat.usage.metric.output"), t("chat.usage.metric.total")];
  const summaryAligned = alignCols(summaryGrid);
  const summary: [string, string][] = summaryLabels.map((label, i) => [label, summaryAligned[i]]);
  const breakdown: [string, string][] = [];
  if (last.promptBreakdown) {
    const bd = last.promptBreakdown;
    const total = Math.max(bd.usedTokens, last.usage.inputTokens);
    const breakdownGrid: string[][] = [];
    const breakdownLabels: string[] = [];
    for (const [label, tokens] of [
      [t("chat.usage.metric.system"), bd.systemTokens],
      [t("chat.usage.metric.tools"), bd.toolTokens],
      [t("chat.usage.metric.memory"), bd.memoryTokens],
      [t("chat.usage.metric.messages"), bd.messageTokens],
    ] as [string, number][]) {
      breakdownLabels.push(label);
      breakdownGrid.push([formatUsageValue(tokens), formatShare(tokens, total)]);
    }
    const breakdownAligned = alignCols(breakdownGrid);
    for (let i = 0; i < breakdownLabels.length; i++) {
      breakdown.push([breakdownLabels[i], breakdownAligned[i]]);
    }
  }
  const sections: [string, string][][] = [summary];
  if (breakdown.length > 0) sections.push(breakdown);
  return [createRow("system", { header: t("chat.usage.header"), sections })];
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
  toRows: (messages: Session["messages"]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowHelp: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: () => void | Promise<void>;
  persistModelConfig?: (key: string, value: string, scope: ConfigScope) => Promise<void>;
  activateSkill?: (skillName: string, args: string) => Promise<boolean>;
  startAssistantTurn?: (userText: string) => Promise<void>;
  clearTranscript: (sessionId?: string) => void;
  tokenUsage: SessionTokenUsageEntry[];
  memoryApi?: {
    listMemories: typeof listMemories;
    addMemory: typeof addMemory;
    removeMemory: typeof removeMemory;
  };
  workspacesApi?: {
    resolveGitRepoRoot: typeof resolveGitRepoRoot;
    createGitWorktree: typeof createGitWorktree;
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

function parseModelCommand(resolvedText: string): string | null {
  const parts = resolvedText.trim().split(/\s+/);
  if (parts[0] !== "/model" || parts.length !== 2) return null;
  const parsed = modelIdSchema.safeParse(parts[1]);
  return parsed.success ? parsed.data : null;
}

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const memoryApi = {
    listMemories,
    addMemory,
    removeMemory,
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
        createRow("system", formatUsage("/resume <session-id-prefix>")),
        ...recent.map((line) => createRow("system", line)),
      ]);
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

  if (resolvedText === "/workspaces" || resolvedText.startsWith("/workspaces ")) {
    if (!appConfig.features.parallelWorkspaces) {
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.disabled"))]);
      return { stop: true, userText: text };
    }

    const workspacesApi = {
      resolveGitRepoRoot,
      createGitWorktree,
      ...ctx.workspacesApi,
    };

    const parts = resolvedText.trim().split(/\s+/);
    const sub = parts[1] ?? "list";

    if (sub === "list" && parts.length <= 2) {
      const workspaces = ctx.store.sessions
        .filter((s) => typeof s.workspaceName === "string" && s.workspaceName.length > 0)
        .map((s) => ({
          id: s.id,
          name: s.workspaceName ?? "",
          branch: s.workspaceBranch ?? "",
          path: s.workspace ?? "",
        }));
      if (workspaces.length === 0) {
        ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.list.none"))]);
        return { stop: true, userText: text };
      }
      const grid = workspaces.map((ws) => {
        const active = ws.id === ctx.store.activeSessionId ? "●" : " ";
        const branch = ws.branch.length > 0 ? ws.branch : "—";
        const path = ws.path.length > 0 ? ws.path : "—";
        return [`${active} ${ws.name}`, branch, path];
      });
      const list = alignCols(grid);
      ctx.setRows((current) => [
        ...current,
        createRow("system", { header: t("chat.workspaces.header", { count: workspaces.length }), sections: [], list }),
      ]);
      return { stop: true, userText: text };
    }

    if (sub === "new") {
      const args = parts.slice(2);
      const showUsage = (): CommandResult => {
        ctx.setRows((current) => [
          ...current,
          createRow("system", formatUsage("/workspaces new <name>")),
          createRow("system", t("chat.workspaces.new.hint_named")),
          createRow("system", t("chat.workspaces.new.hint_auto")),
        ]);
        return { stop: true, userText: text };
      };

      if (args.length === 0) return showUsage();

      const delimiterIndex = args.indexOf("--");
      let baseName: z.infer<typeof workspaceNameSchema>;
      let prompt = "";

      if (delimiterIndex === -1) {
        if (args.length !== 1) return showUsage();
        const parsedName = workspaceNameSchema.safeParse(args[0]);
        if (!parsedName.success) return showUsage();
        baseName = parsedName.data;
      } else if (delimiterIndex === 0) {
        prompt = args.slice(1).join(" ").trim();
        if (prompt.length === 0) {
          ctx.setRows((current) => [...current, createRow("system", formatUsage("/workspaces new -- <prompt>"))]);
          return { stop: true, userText: text };
        }
        baseName = suggestWorkspaceName(prompt);
      } else if (delimiterIndex === 1) {
        const parsedName = workspaceNameSchema.safeParse(args[0]);
        if (!parsedName.success) return showUsage();
        baseName = parsedName.data;
        prompt = args.slice(2).join(" ").trim();
      } else {
        ctx.setRows((current) => [
          ...current,
          createRow("system", formatUsage("/workspaces new <name> -- <prompt>")),
          createRow("system", t("chat.workspaces.new.hint_auto")),
        ]);
        return { stop: true, userText: text };
      }
      const existing = new Set(
        ctx.store.sessions
          .map((s) => (typeof s.workspaceName === "string" && s.workspaceName.length > 0 ? s.workspaceName : null))
          .filter((s): s is string => typeof s === "string"),
      );
      let name = baseName;
      for (let n = 2; existing.has(name) && n < 100; n++) {
        const suffix = `-${n}`;
        const trimmed = `${baseName}`.slice(0, Math.max(1, 40 - suffix.length));
        const candidate = `${trimmed}${suffix}`;
        const parsed = workspaceNameSchema.safeParse(candidate);
        if (!parsed.success) continue;
        name = parsed.data;
      }

      if (existing.has(name)) {
        ctx.setRows((current) => [
          ...current,
          createRow("system", t("chat.workspaces.name_conflict")),
        ]);
        return { stop: true, userText: text };
      }
      const repoRoot = await workspacesApi.resolveGitRepoRoot(process.cwd());
      const created = await workspacesApi.createGitWorktree({ repoRoot, name, baseRef: "HEAD" });
      const next = createSession(appConfig.model);
      next.workspaceName = name;
      next.workspace = created.workspacePath;
      next.workspaceBranch = created.branch;
      next.title = prompt.length > 0 ? prompt : name;
      ctx.store.sessions.unshift(next);
      ctx.store.activeSessionId = next.id;
      ctx.setCurrentSession(next);
      ctx.setTokenUsage?.(() => []);
      ctx.clearTranscript(next.id);
      ctx.setRows(() => ctx.toRows(next.messages));
      ctx.setShowHelp(() => false);
      await ctx.persist();
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.created", { name }))]);

      if (prompt.length > 0 && ctx.startAssistantTurn) {
        void ctx.startAssistantTurn(prompt);
        return { stop: true, userText: prompt };
      }
      return { stop: true, userText: text };
    }

    if (sub === "switch") {
      const name = workspaceNameSchema.safeParse(parts[2]);
      if (!name.success || parts.length !== 3) {
        ctx.setRows((current) => [...current, createRow("system", formatUsage("/workspaces switch <name>"))]);
        return { stop: true, userText: text };
      }
      const target = ctx.store.sessions.find((s) => s.workspaceName === name.data);
      if (!target) {
        ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.not_found", { name: name.data }))]);
        return { stop: true, userText: text };
      }
      ctx.store.activeSessionId = target.id;
      ctx.setCurrentSession(target);
      ctx.setTokenUsage?.(() => target.tokenUsage);
      ctx.clearTranscript(target.id);
      ctx.setRows(() => ctx.toRows(target.messages));
      ctx.setShowHelp(() => false);
      await ctx.persist();
      ctx.setRows((current) => [...current, createRow("system", t("chat.workspaces.switched", { name: name.data }))]);
      return { stop: true, userText: text };
    }

    ctx.setRows((current) => [
      ...current,
      createRow("system", formatUsage("/workspaces [list|new|switch] ...")),
    ]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/status") {
    try {
      const status = await ctx.client.status();
      ctx.setRows((current) => [...current, ...statusRows(status)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("chat.status.check_failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/model") {
    ctx.openModelPanel();
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/model ")) {
    const model = parseModelCommand(resolvedText);
    if (!model) {
      ctx.setRows((current) => [...current, createRow("system", formatUsage("/model <id>"))]);
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
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("chat.model.changed", { model: formatModel(model) })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("chat.model.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText.startsWith("/memory rm")) {
    const parts = resolvedText.trim().split(/\s+/);
    if (parts.length !== 3) {
      ctx.setRows((current) => [...current, createRow("system", formatUsage("/memory rm <id-prefix>"))]);
      return { stop: true, userText: text };
    }
    const prefix = parts[2];
    try {
      const removed = await memoryApi.removeMemory(prefix);
      if (removed.kind === "not_found") {
        ctx.setRows((current) => [...current, createRow("system", t("chat.memory.rm.not_found", { id: removed.id }))]);
        return { stop: true, userText: text };
      }
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("chat.memory.rm.removed", { scope: removed.entry.scope, id: removed.entry.id })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("chat.memory.rm.failed")),
      ]);
    }
    return { stop: true, userText: text };
  }

  if (resolvedText === "/memory" || resolvedText.startsWith("/memory ")) {
    const parts = resolvedText.split(/\s+/);
    const scope = parseMemoryListScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, createRow("system", formatUsage("/memory [all|user|project]"))]);
      return { stop: true, userText: text };
    }
    const memories = await memoryApi.listMemories({ scope: scope === "all" ? undefined : scope });
    if (memories.length === 0) {
      const emptyLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, createRow("system", t("chat.memory.none", { scope: emptyLabel }))]);
      return { stop: true, userText: text };
    }
    const list = memories.slice(0, 10).map((entry) => `${entry.scope}:${entry.id} ${entry.content}`);
    const header =
      scope === "all"
        ? t("chat.memory.header.all", { count: memories.length })
        : t("chat.memory.header.scope", { scope: scopeLabel(scope), count: memories.length });
    ctx.setRows((current) => [...current, createRow("system", { header, sections: [], list })]);
    return { stop: true, userText: text };
  }

  if (resolvedText === "/usage") {
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    ctx.setRows((current) => [...current, ...usageRows(last, ctx.tokenUsage)]);
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
        createRow("system", formatUsage("/remember [--user|--project] <memory text>")),
      ]);
      return { stop: true, userText: text };
    }
    try {
      const entry = await memoryApi.addMemory(content, { scope });
      ctx.setRows((current) => [
        ...current,
        createRow("system", t("chat.remember.saved", { scope: entry.scope, content })),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        createRow("system", error instanceof Error ? error.message : t("chat.remember.failed")),
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
        ctx.setRows((current) => [...current, createRow("system", t("chat.skill.failed", { skill: skill.name }))]);
        return { stop: true, userText: text };
      }
      const runPrompt = args || t("chat.skill.run_prompt", { skill: skill.name });
      if (ctx.startAssistantTurn) {
        void ctx.startAssistantTurn(runPrompt);
        return { stop: true, userText: text };
      }
      return { stop: false, userText: runPrompt };
    }

    ctx.setRows((current) => [...current, createRow("system", t("chat.command.unknown", { command: text }))]);
    return { stop: true, userText: text };
  }

  return { stop: false, userText: text };
}
