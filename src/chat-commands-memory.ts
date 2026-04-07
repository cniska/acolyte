import type {
  CommandContext,
  CommandResult,
  ParsedCommand,
  SlashCommand,
  SubcommandGroup,
} from "./chat-commands-contract";
import { dispatchSubcommandGroup } from "./chat-commands-contract";
import { createRow } from "./chat-contract";
import { formatUsage } from "./cli-help";
import { t } from "./i18n";
import type { MemoryScope } from "./memory-contract";
import { addMemory, listMemories, removeMemory } from "./memory-ops";

type MemoryContextScope = "all" | "user" | "project";

function isMemoryContextScope(value: string): value is MemoryContextScope {
  return value === "all" || value === "user" || value === "project";
}

function scopeLabel(scope: MemoryContextScope): string {
  if (scope === "user") return t("chat.scope.user");
  if (scope === "project") return t("chat.scope.project");
  return t("chat.scope.all");
}

export function resolveMemoryApi(ctx: CommandContext): {
  listMemories: typeof listMemories;
  addMemory: typeof addMemory;
  removeMemory: typeof removeMemory;
} {
  return {
    listMemories,
    addMemory,
    removeMemory,
    ...ctx.memoryApi,
  };
}

async function handleMemoryRm(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const { text } = ctx;
  const prefix = parsed.args[0];
  if (!prefix || parsed.args.length !== 1) {
    ctx.setRows((current) => [...current, createRow("system", formatUsage("/memory rm <id-prefix>"))]);
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

async function handleMemoryList(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
  parsed: ParsedCommand,
): Promise<CommandResult> {
  const { text } = ctx;
  const scope: MemoryContextScope = parsed.sub === "" ? "all" : (parsed.sub as MemoryContextScope);
  if (parsed.args.length > 0) {
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

async function handleRemember(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
): Promise<CommandResult> {
  const { text, resolvedText } = ctx;
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

function createMemoryGroup(ctx: CommandContext, memoryApi: ReturnType<typeof resolveMemoryApi>): SubcommandGroup {
  return {
    root: "memory",
    subcommands: [
      {
        name: "rm",
        match: (sub) => sub === "rm",
        run: (parsed) => handleMemoryRm(ctx, memoryApi, parsed),
      },
      {
        name: "list",
        match: (sub) => sub === "" || isMemoryContextScope(sub),
        run: (parsed) => handleMemoryList(ctx, memoryApi, parsed),
      },
    ],
    fallback: async () => {
      ctx.setRows((current) => [...current, createRow("system", formatUsage("/memory [all|user|project]"))]);
      return { stop: true, userText: ctx.text };
    },
  };
}

export function createMemoryCommands(
  ctx: CommandContext,
  memoryApi: ReturnType<typeof resolveMemoryApi>,
): SlashCommand[] {
  const group = createMemoryGroup(ctx, memoryApi);
  return [
    {
      name: "memory",
      match: (value) => value === "/memory" || value.startsWith("/memory "),
      run: () => dispatchSubcommandGroup(group, ctx.resolvedText),
    },
    { name: "remember", match: (value) => value.startsWith("/remember"), run: () => handleRemember(ctx, memoryApi) },
  ];
}
