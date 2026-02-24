import { appConfig, setPermissionMode } from "./app-config";
import type { Backend } from "./backend";
import { suggestClosestSlashCommand } from "./chat-slash";
import type { ConfigScope } from "./config";
import { setConfigValue } from "./config";
import { addMemory, listMemories, removeMemoryByPrefix } from "./memory";
import { distillPolicyCandidatesFromSessions, distillPolicyFromSessions, parseDistillOptions } from "./policy-distill";
import { getMemoryContextEntries, type MemoryContextScope } from "./soul";
import { formatStatusOutput } from "./status-format";
import { createSession } from "./storage";
import type { Session, SessionStore, SessionTokenUsageEntry } from "./types";

export type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  dim?: boolean;
  style?: "sessionStatus" | "sessionsList" | "toolProgress" | "statusOutput" | "tokenOutput";
};

export type TokenUsageEntry = SessionTokenUsageEntry;

export type ResumeResolution =
  | { kind: "usage" }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: Session[] }
  | { kind: "ok"; session: Session };

export function resolveResumeSession(store: SessionStore, text: string): ResumeResolution {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length < 2) {
    return { kind: "usage" };
  }
  const prefix = parts[1];
  const matches = store.sessions.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0) {
    return { kind: "not_found", prefix };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", prefix, matches };
  }
  return { kind: "ok", session: matches[0] };
}

export function formatSessionList(store: SessionStore, limit = 10): string[] {
  return store.sessions.slice(0, limit).map((item) => {
    const active = item.id === store.activeSessionId ? "●" : " ";
    const title = item.title || "New Session";
    return `${active} ${item.id.slice(0, 12)}  ${title}`;
  });
}

export function formatTokenUsageOutput(last: TokenUsageEntry | null, all: TokenUsageEntry[]): string {
  if (!last) {
    return "No token data yet. Send a prompt first.";
  }
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
  const maxKey = rows.reduce((max, row) => Math.max(max, row.key.length), 0);
  return rows.map((row) => `${row.key.padEnd(maxKey, " ")} ${row.value}`).join("\n");
}

type CommandResult = {
  stop: boolean;
  userText: string;
  runVerifyAfterReply: boolean;
};

type CommandContext = {
  text: string;
  resolvedText: string;
  backend: Backend;
  store: SessionStore;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  toRows: (messages: Session["messages"]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowShortcuts: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openPolicyPanel: (items: ReturnType<typeof distillPolicyCandidatesFromSessions>) => void;
  setBackendPermissionMode: (mode: "read" | "write") => Promise<void>;
  setConfigPermissionMode?: (mode: "read" | "write", scope: ConfigScope) => Promise<void>;
  tokenUsage: TokenUsageEntry[];
  memoryApi?: {
    listMemories: typeof listMemories;
    addMemory: typeof addMemory;
    removeMemoryByPrefix?: typeof removeMemoryByPrefix;
    getMemoryContextEntries?: typeof getMemoryContextEntries;
  };
};

function row(role: ChatRow["role"], content: string, dim = false, style?: ChatRow["style"]): ChatRow {
  return { id: `row_${crypto.randomUUID()}`, role, content, dim, style };
}

function buildDogfoodPrompt(task: string): string {
  const preamble = [
    "Dogfood mode:",
    "- Work in small, verifiable steps.",
    "- Keep response concise and action-focused.",
    "- Use tools when needed; avoid guessing.",
    "- If edits are made, verify with bun run verify before final response.",
    "- Return: (1) what changed, (2) validation result, (3) any residual risk/blocker.",
    "- Keep output short unless asked for detail.",
    "",
  ].join("\n");
  return `${preamble}${task}`;
}

function parseMemoryContextScope(parts: string[]): MemoryContextScope | null {
  if (parts.length === 2) {
    return "all";
  }
  if (parts.length !== 3) {
    return null;
  }
  const scope = parts[2];
  if (scope === "all" || scope === "user" || scope === "project") {
    return scope;
  }
  return null;
}

function parseMemoryListScope(parts: string[]): MemoryContextScope | null {
  if (parts.length === 1) {
    return "all";
  }
  if (parts.length !== 2) {
    return null;
  }
  const scope = parts[1];
  if (scope === "all" || scope === "user" || scope === "project") {
    return scope;
  }
  return null;
}

function scopeLabel(scope: MemoryContextScope): string {
  if (scope === "user") {
    return "User";
  }
  if (scope === "project") {
    return "Project";
  }
  return "All";
}

function parsePermissionsScope(parts: string[]): ConfigScope | null {
  if (parts.length < 2) {
    return null;
  }
  const flag = parts.find((part) => part === "--project" || part === "--user");
  if (!flag) {
    return "project";
  }
  return flag === "--user" ? "user" : "project";
}

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
  const memoryApi = {
    listMemories,
    addMemory,
    removeMemoryByPrefix,
    getMemoryContextEntries,
    ...ctx.memoryApi,
  };
  const pushUserCommandRow = (): void => {
    ctx.setRows((current) => [...current, row("user", text)]);
  };

  if (resolvedText === "/resume") {
    pushUserCommandRow();
    ctx.openResumePanel();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/resume")) {
    pushUserCommandRow();
    const resolved = resolveResumeSession(ctx.store, resolvedText);
    if (resolved.kind === "usage") {
      const recent = formatSessionList(ctx.store, 6);
      ctx.setRows((current) => [
        ...current,
        row("system", "Usage: /resume <session-id-prefix>"),
        ...recent.map((line) => row("system", line)),
      ]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    if (resolved.kind === "not_found") {
      ctx.setRows((current) => [...current, row("system", `No session found for prefix: ${resolved.prefix}`)]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    if (resolved.kind === "ambiguous") {
      ctx.setRows((current) => [
        ...current,
        row(
          "system",
          `Ambiguous prefix: ${resolved.prefix}. Matches: ${resolved.matches.map((item) => item.id.slice(0, 12)).join(", ")}`,
        ),
      ]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const target = resolved.session;
    ctx.store.activeSessionId = target.id;
    ctx.setCurrentSession(target);
    ctx.setTokenUsage?.(() => target.tokenUsage);
    ctx.setRows(() => [
      ...ctx.toRows(target.messages),
      row("system", `Resumed session: ${target.id.slice(0, 12)}`, true, "sessionStatus"),
    ]);
    ctx.setShowShortcuts(() => false);
    await ctx.persist();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/sessions") {
    pushUserCommandRow();
    const recent = formatSessionList(ctx.store, 10);
    const sections = [`Sessions ${ctx.store.sessions.length}`, "", ...recent];
    ctx.setRows((current) => [...current, row("system", sections.join("\n"), false, "sessionsList")]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/status") {
    pushUserCommandRow();
    try {
      const status = await ctx.backend.status();
      ctx.setRows((current) => [...current, row("system", formatStatusOutput(status), false, "statusOutput")]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Status check failed."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/permissions") {
    pushUserCommandRow();
    ctx.openPermissionsPanel();
    return { stop: true, userText: text, runVerifyAfterReply: false };
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
      ctx.setRows((current) => [...current, row("system", "Usage: /permissions [read|write] [--project|--user]")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const scope = parsePermissionsScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, row("system", "Usage: /permissions [read|write] [--project|--user]")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    try {
      await ctx.setBackendPermissionMode(mode);
      if (ctx.setConfigPermissionMode) {
        await ctx.setConfigPermissionMode(mode, scope);
      } else {
        await setConfigValue("permissionMode", mode, { scope });
      }
      setPermissionMode(mode);
      ctx.setRows((current) => [...current, row("system", `Changed permissions to ${mode} (${scope}).`)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Failed to set permission mode."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/memory rm")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 3) {
      ctx.setRows((current) => [...current, row("system", "Usage: /memory rm <id-prefix>")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const prefix = parts[2];
    const remove = memoryApi.removeMemoryByPrefix;
    if (!remove) {
      ctx.setRows((current) => [...current, row("system", "Memory removal is unavailable in this context.")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    try {
      const removed = await remove(prefix);
      if (removed.kind === "not_found") {
        ctx.setRows((current) => [...current, row("system", `No memory found for id prefix: ${removed.prefix}`)]);
        return { stop: true, userText: text, runVerifyAfterReply: false };
      }
      if (removed.kind === "ambiguous") {
        const ids = removed.matches.map((item) => item.id.slice(0, 12)).join(", ");
        ctx.setRows((current) => [
          ...current,
          row("system", `Ambiguous memory id prefix: ${removed.prefix}. Matches: ${ids}`),
        ]);
        return { stop: true, userText: text, runVerifyAfterReply: false };
      }
      ctx.setRows((current) => [
        ...current,
        row("system", `Removed ${removed.entry.scope} memory ${removed.entry.id.slice(0, 12)}.`),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Failed to remove memory."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (
    resolvedText === "/memory" ||
    (resolvedText.startsWith("/memory ") && !resolvedText.startsWith("/memory context"))
  ) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/);
    const scope = parseMemoryListScope(parts);
    if (!scope) {
      ctx.setRows((current) => [
        ...current,
        row("system", "Usage: /memory [all|user|project] | /memory context [all|user|project]"),
      ]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const memories = await memoryApi.listMemories({ scope });
    if (memories.length === 0) {
      const scopeLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, row("system", `No ${scopeLabel}memory saved yet.`)]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const lines = memories.slice(0, 10).map((entry) => `${entry.scope}:${entry.id.slice(0, 12)} ${entry.content}`);
    const header = scope === "all" ? `Memory ${memories.length}` : `${scopeLabel(scope)} memory ${memories.length}`;
    ctx.setRows((current) => [...current, row("system", `${header}\n\n${lines.join("\n")}`)]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/memory context" || resolvedText.startsWith("/memory context ")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/);
    const scope = parseMemoryContextScope(parts);
    if (!scope) {
      ctx.setRows((current) => [...current, row("system", "Usage: /memory context [all|user|project]")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const entries = await memoryApi.getMemoryContextEntries({ scope });
    if (entries.length === 0) {
      const scopeLabel = scope === "all" ? "" : `${scope} `;
      ctx.setRows((current) => [...current, row("system", `No ${scopeLabel}memory context is currently injected.`)]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const lines = entries.map((entry) => `${entry.scope}: ${entry.content}`);
    const header =
      scope === "all" ? `Memory context ${entries.length}` : `${scopeLabel(scope)} memory context ${entries.length}`;
    ctx.setRows((current) => [...current, row("system", `${header}\n\n${lines.join("\n")}`)]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/memory ")) {
    pushUserCommandRow();
    ctx.setRows((current) => [
      ...current,
      row("system", "Usage: /memory [all|user|project] | /memory context [all|user|project]"),
    ]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/distill")) {
    pushUserCommandRow();
    const args = resolvedText.split(/\s+/).slice(1);
    const parsed = parseDistillOptions(args);
    if (!parsed.ok) {
      ctx.setRows((current) => [...current, row("system", parsed.error)]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const candidates = distillPolicyCandidatesFromSessions(ctx.store.sessions, parsed.options);
    const output = distillPolicyFromSessions(ctx.store.sessions, parsed.options);
    ctx.setRows((current) => [...current, row("system", output)]);
    if (candidates.length > 0) {
      ctx.openPolicyPanel(candidates);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/tokens") {
    pushUserCommandRow();
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    ctx.setRows((current) => [
      ...current,
      row("system", formatTokenUsageOutput(last, ctx.tokenUsage), false, "tokenOutput"),
    ]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/remember")) {
    pushUserCommandRow();
    const parts = resolvedText.split(/\s+/).slice(1);
    let scope: "user" | "project" = "user";
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
      ctx.setRows((current) => [...current, row("system", "Usage: /remember [--user|--project] <memory text>")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    try {
      const entry = await memoryApi.addMemory(content, { scope });
      ctx.setRows((current) => [...current, row("system", `Saved ${entry.scope} memory: ${content}`)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Failed to save memory."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/skills") {
    pushUserCommandRow();
    await ctx.openSkillsPanel();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/new") {
    const next = createSession(appConfig.model);
    ctx.store.sessions.unshift(next);
    ctx.store.activeSessionId = next.id;
    ctx.setCurrentSession(next);
    ctx.setTokenUsage?.(() => []);
    ctx.setRows(() => [
      row("user", text),
      row("system", `Started new session: ${next.id.slice(0, 12)}`, true, "sessionStatus"),
    ]);
    ctx.setValue("");
    ctx.setShowShortcuts(() => false);
    await ctx.persist();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/exit") {
    pushUserCommandRow();
    await ctx.persist();
    ctx.exit();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/dogfood")) {
    const parts = resolvedText.split(/\s+/).slice(1);
    let noVerify = false;
    const taskParts: string[] = [];
    for (const part of parts) {
      if (part === "--no-verify") {
        noVerify = true;
        continue;
      }
      taskParts.push(part);
    }
    const task = taskParts.join(" ").trim();
    if (!task) {
      ctx.setRows((current) => [...current, row("system", "Usage: /dogfood [--no-verify] <task>")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    const runVerifyAfterReply = !noVerify;
    ctx.setRows((current) => [
      ...current,
      row(
        "system",
        runVerifyAfterReply ? "Dogfood mode enabled (verify after reply)." : "Dogfood mode enabled (no verify).",
      ),
    ]);
    return { stop: false, userText: buildDogfoodPrompt(task), runVerifyAfterReply };
  }

  if (resolvedText.startsWith("/")) {
    pushUserCommandRow();
    if (resolvedText === "/skill" || resolvedText.startsWith("/skill ")) {
      ctx.setRows((current) => [...current, row("system", "Unknown command: /skill. Did you mean /skills?")]);
    } else if (resolvedText === "/compact" || resolvedText.startsWith("/compact ")) {
      ctx.setRows((current) => [...current, row("system", "Unknown command: /compact. Did you mean /dogfood?")]);
    } else if (resolvedText === "/cmp" || resolvedText.startsWith("/cmp ")) {
      ctx.setRows((current) => [...current, row("system", "Unknown command: /cmp. Did you mean /dogfood?")]);
    } else {
      const suggested = suggestClosestSlashCommand(resolvedText);
      const message = suggested ? `Unknown command: ${text}. Did you mean ${suggested}?` : `Unknown command: ${text}`;
      ctx.setRows((current) => [...current, row("system", message)]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  return { stop: false, userText: text, runVerifyAfterReply: false };
}
