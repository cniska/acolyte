import type { TokenUsage } from "./api";
import { appConfig } from "./app-config";
import type { Backend } from "./backend";
import { formatChangesSummary, formatDogfoodStatus, formatVerifySummary } from "./chat-formatters";
import { suggestClosestSlashCommand } from "./chat-slash";
import { gitDiff, gitStatusShort, runShellCommand, searchWeb } from "./coding-tools";
import { addMemory, listMemories } from "./memory";
import { formatStatusOutput } from "./status-format";
import { createSession } from "./storage";
import type { Session, SessionStore } from "./types";

export type ChatRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  dim?: boolean;
};

export type TokenUsageEntry = {
  id: string;
  usage: TokenUsage;
  warning?: string;
};

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
    const active = item.id === store.activeSessionId ? "*" : " ";
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
      return acc;
    },
    { prompt: 0, completion: 0, total: 0 },
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
  if (last.usage.promptBudgetTokens) {
    rows.push({
      key: "budget:",
      value: `${last.usage.promptTokens}/${last.usage.promptBudgetTokens}${last.usage.promptTruncated ? " (trimmed)" : ""}`,
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
  toRows: (messages: Session["messages"]) => ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setShowShortcuts: (updater: (current: boolean) => boolean) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  exit: () => void;
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  tokenUsage: TokenUsageEntry[];
};

function row(role: ChatRow["role"], content: string, dim = false): ChatRow {
  return { id: `row_${crypto.randomUUID()}`, role, content, dim };
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

export async function dispatchSlashCommand(ctx: CommandContext): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
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
    ctx.setRows(() => [...ctx.toRows(target.messages), row("assistant", `Resumed session: ${target.id.slice(0, 12)}`)]);
    ctx.setShowShortcuts(() => false);
    await ctx.persist();
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/sessions") {
    pushUserCommandRow();
    const recent = formatSessionList(ctx.store, 10);
    ctx.setRows((current) => [
      ...current,
      row("system", `Sessions (${ctx.store.sessions.length})`),
      ...recent.map((line) => row("system", line)),
    ]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/status") {
    pushUserCommandRow();
    try {
      const status = await ctx.backend.status();
      ctx.setRows((current) => [...current, row("assistant", formatStatusOutput(status))]);
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
    ctx.setRows((current) => [...current, row("assistant", `permissions: ${appConfig.agent.permissions.mode}`)]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/changes") {
    pushUserCommandRow();
    try {
      const [statusRaw, diffRaw] = await Promise.all([gitStatusShort(), gitDiff()]);
      ctx.setRows((current) => [...current, row("assistant", formatChangesSummary(statusRaw, diffRaw))]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Could not inspect git changes."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText.startsWith("/web")) {
    pushUserCommandRow();
    const query = resolvedText.replace(/^\/web\s*/, "").trim();
    if (!query) {
      ctx.setRows((current) => [...current, row("system", "Usage: /web <query>")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    try {
      const result = await searchWeb(query, 5);
      ctx.setRows((current) => [...current, row("assistant", result)]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Web search failed."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/dogfood-status") {
    pushUserCommandRow();
    ctx.setRows((current) => [...current, row("system", "Checking dogfood status…", true)]);
    try {
      const [backendStatus, verifyRaw] = await Promise.all([
        ctx.backend.status().catch((error) => (error instanceof Error ? error.message : "status unavailable")),
        runShellCommand("bun run verify", 30_000).catch((error) =>
          error instanceof Error
            ? `exit_code=1\nduration_ms=0\nstderr:\n${error.message}`
            : "exit_code=1\nduration_ms=0",
        ),
      ]);
      const verifySummary = formatVerifySummary(verifyRaw);
      ctx.setRows((current) => [
        ...current,
        row(
          "assistant",
          formatDogfoodStatus({ backendStatus, verifySummary, hasApiKey: Boolean(appConfig.openai.apiKey) }),
        ),
      ]);
    } catch (error) {
      ctx.setRows((current) => [
        ...current,
        row("system", error instanceof Error ? error.message : "Could not run dogfood status checks."),
      ]);
    }
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/memory") {
    pushUserCommandRow();
    const memories = await listMemories();
    if (memories.length === 0) {
      ctx.setRows((current) => [...current, row("system", "No memories saved.")]);
      return { stop: true, userText: text, runVerifyAfterReply: false };
    }
    ctx.setRows((current) => [
      ...current,
      row("system", `Memories (${memories.length})`),
      ...memories.slice(0, 10).map((entry) => row("system", `- [${entry.scope}] ${entry.content}`)),
    ]);
    return { stop: true, userText: text, runVerifyAfterReply: false };
  }

  if (resolvedText === "/tokens") {
    pushUserCommandRow();
    const last = ctx.tokenUsage.length > 0 ? ctx.tokenUsage[ctx.tokenUsage.length - 1] : null;
    ctx.setRows((current) => [...current, row("assistant", formatTokenUsageOutput(last, ctx.tokenUsage))]);
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
      const entry = await addMemory(content, { scope });
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
    pushUserCommandRow();
    const next = createSession(ctx.currentSession.model);
    ctx.store.sessions.unshift(next);
    ctx.store.activeSessionId = next.id;
    ctx.setCurrentSession(next);
    ctx.setRows((current) => [...current, row("assistant", `Started new session: ${next.id.slice(0, 12)}`)]);
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
