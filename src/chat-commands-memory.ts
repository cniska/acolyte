import { fullUsage, MEMORY_SPEC, subcommandUsage } from "./chat-command-specs";
import type { CommandContext, CommandHandler, CommandResult, ParsedCommand } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { formatUsage } from "./cli-help";
import { type TranslationKey, t } from "./i18n";
import { formatDisposition, type MemoryScope } from "./memory-contract";
import { addMemory, listArchivedMemories, listMemories, removeMemory } from "./memory-ops";

type MemoryContextScope = "all" | "user" | "project";

const ARCHIVED_FLAG = "--archived";

function isMemoryContextScope(value: string): value is MemoryContextScope {
  return value === "all" || value === "user" || value === "project";
}

const NONE_KEYS = {
  all: "chat.memory.none.all",
  project: "chat.memory.none.project",
  user: "chat.memory.none.user",
} as const satisfies Record<MemoryContextScope, TranslationKey>;

const SAVED_KEYS = {
  project: "chat.remember.saved.project",
  user: "chat.remember.saved.user",
  session: "chat.remember.saved.session",
} as const satisfies Record<MemoryScope, TranslationKey>;

const REMOVED_KEYS = {
  project: "chat.memory.rm.removed.project",
  user: "chat.memory.rm.removed.user",
  session: "chat.memory.rm.removed.session",
} as const satisfies Record<MemoryScope, TranslationKey>;

function scopeLabel(scope: MemoryContextScope): string {
  if (scope === "user") return t("chat.scope.user");
  if (scope === "project") return t("chat.scope.project");
  return t("chat.scope.all");
}

export function resolveMemoryApi(ctx: CommandContext): {
  listMemories: typeof listMemories;
  addMemory: typeof addMemory;
  removeMemory: typeof removeMemory;
  listArchivedMemories: typeof listArchivedMemories;
} {
  return {
    listMemories,
    addMemory,
    removeMemory,
    listArchivedMemories,
    ...ctx.memoryApi,
  };
}

async function handleMemoryRemove(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const { text } = ctx;
  const prefix = parsed.args[0];
  if (!prefix || parsed.args.length !== 1) {
    ctx.setRows((current) => [...current, createRow("system", formatUsage(subcommandUsage(MEMORY_SPEC, "rm")))]);
    return { stop: true, userText: text };
  }
  try {
    const removed = await memoryApi.removeMemory(prefix);
    if (removed.kind === "not_found") {
      ctx.setRows((current) => [...current, createRow("system", t("chat.memory.rm.not_found", { id: removed.id }))]);
      return { stop: true, userText: text };
    }
    ctx.setRows((current) => [
      ...current,
      createRow("system", t(REMOVED_KEYS[removed.entry.scope], { id: removed.entry.id })),
    ]);
  } catch (error) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", error instanceof Error ? error.message : t("chat.memory.rm.failed")),
    ]);
  }
  return { stop: true, userText: text };
}

async function handleMemoryList(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const { text } = ctx;
  const archived = parsed.args.includes(ARCHIVED_FLAG);
  const scopeTokens = parsed.args.filter((arg) => arg !== ARCHIVED_FLAG);
  const scopeToken = scopeTokens[0] ?? "";
  if (scopeToken !== "" && !isMemoryContextScope(scopeToken)) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", t("chat.command.unknown_subcommand", { subcommand: scopeToken })),
      ...fullUsage(MEMORY_SPEC).map((usage) => createRow("system", formatUsage(usage))),
    ]);
    return { stop: true, userText: text };
  }
  if (scopeTokens.length > 1) {
    ctx.setRows((current) => [...current, createRow("system", formatUsage(subcommandUsage(MEMORY_SPEC, "list")))]);
    return { stop: true, userText: text };
  }
  const scope: MemoryContextScope = scopeToken === "" ? "all" : scopeToken;
  const resolvedScope = scope === "all" ? undefined : scope;
  try {
    if (archived) return await renderArchivedList(ctx, memoryApi, scope, resolvedScope);
    return await renderMemoryList(ctx, memoryApi, scope, resolvedScope);
  } catch (error) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", error instanceof Error ? error.message : t("chat.memory.list.failed")),
    ]);
    return { stop: true, userText: text };
  }
}

async function renderMemoryList(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  scope: MemoryContextScope,
  resolvedScope: MemoryScope | undefined,
): Promise<CommandResult> {
  const { text } = ctx;
  const memories = await memoryApi.listMemories({ scope: resolvedScope });
  if (memories.length === 0) {
    ctx.setRows((current) => [...current, createRow("system", t(NONE_KEYS[scope]))]);
    return { stop: true, userText: text };
  }
  const list = memories
    .slice(0, 10)
    .map((entry) => `${entry.scope}:${entry.id}${entry.kind === "observation" ? " (obs)" : ""} ${entry.content}`);
  const header =
    scope === "all"
      ? t("chat.memory.header.all", { count: memories.length })
      : t("chat.memory.header.scope", { scope: scopeLabel(scope), count: memories.length });
  ctx.setRows((current) => [...current, createRow("system", { header, sections: [], list })]);
  return { stop: true, userText: text };
}

async function renderArchivedList(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  scope: MemoryContextScope,
  resolvedScope: MemoryScope | undefined,
): Promise<CommandResult> {
  const { text } = ctx;
  const archived = await memoryApi.listArchivedMemories({ scope: resolvedScope });
  if (archived.length === 0) {
    ctx.setRows((current) => [...current, createRow("system", t("chat.memory.archive.none"))]);
    return { stop: true, userText: text };
  }
  const list = archived
    .slice(0, 10)
    .map((entry) => `${entry.scope}:${entry.id} [${formatDisposition(entry.disposition)}] ${entry.content}`);
  const header =
    scope === "all"
      ? t("chat.memory.archive.header.all", { count: archived.length })
      : t("chat.memory.archive.header.scope", { scope: scopeLabel(scope), count: archived.length });
  ctx.setRows((current) => [...current, createRow("system", { header, sections: [], list })]);
  return { stop: true, userText: text };
}

async function handleMemoryAdd(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const { text } = ctx;
  let scope: MemoryScope = "user";
  const contentParts: string[] = [];
  for (const part of parsed.args) {
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
    ctx.setRows((current) => [...current, createRow("system", formatUsage(subcommandUsage(MEMORY_SPEC, "add")))]);
    return { stop: true, userText: text };
  }
  try {
    const entry = await memoryApi.addMemory(content, { scope });
    ctx.setRows((current) => [...current, createRow("system", t(SAVED_KEYS[entry.scope], { content }))]);
  } catch (error) {
    ctx.setRows((current) => [
      ...current,
      createRow("system", error instanceof Error ? error.message : t("chat.remember.failed")),
    ]);
  }
  return { stop: true, userText: text };
}

export const runMemoryList: CommandHandler = (ctx, parsed) => handleMemoryList(ctx, resolveMemoryApi(ctx), parsed);

export const runMemoryAdd: CommandHandler = (ctx, parsed) => handleMemoryAdd(ctx, resolveMemoryApi(ctx), parsed);

export const runMemoryRemove: CommandHandler = (ctx, parsed) => handleMemoryRemove(ctx, resolveMemoryApi(ctx), parsed);
