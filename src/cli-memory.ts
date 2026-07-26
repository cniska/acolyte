import { hasBoolFlag, stripFlag } from "./cli-args";
import { formatUsage } from "./cli-help";
import { type CliOutput, createJsonOutput, createTextOutput, fitFlexColumn } from "./cli-output";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import { formatDisposition, type MemoryArchiveEntry, type MemoryEntry, type MemoryScope } from "./memory-contract";

type MemoryOps = {
  list: (scope?: MemoryScope) => Promise<MemoryEntry[]>;
  add: (content: string, scope: MemoryScope) => Promise<MemoryEntry>;
  listArchived: (scope?: MemoryScope) => Promise<MemoryArchiveEntry[]>;
  restore: (ids: readonly string[]) => Promise<readonly MemoryEntry[]>;
};

function isArchiveEntry(row: MemoryEntry | MemoryArchiveEntry): row is MemoryArchiveEntry {
  return "retiredAt" in row;
}

function toTableRow(row: MemoryEntry | MemoryArchiveEntry): Record<string, string> {
  const base = { id: row.id, kind: row.kind, content: row.content };
  if (isArchiveEntry(row)) {
    return { ...base, retired: formatRelativeTime(row.retiredAt), why: formatDisposition(row.disposition) };
  }
  return {
    ...base,
    created: formatRelativeTime(row.createdAt),
    recalled: row.lastRecalledAt ? formatRelativeTime(row.lastRecalledAt) : "never",
  };
}

type MemoryModeDeps = {
  ops: MemoryOps;
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export async function memoryMode(args: string[], deps: MemoryModeDeps): Promise<void> {
  const { ops, hasHelpFlag, printDim, commandError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("memory");
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const archived = hasBoolFlag(args, "--archived");
  const [subcommand, ...rest] = stripFlag(stripFlag(args, "--json"), "--archived");
  const validScopes = new Set(["all", "user", "project"]);

  if (subcommand === "list" || !subcommand) {
    const usage = formatUsage("acolyte memory list [all|user|project] [--archived]");
    const scopeRaw = subcommand === "list" ? rest[0] : undefined;
    if (subcommand === "list" && rest.length > 1) {
      commandError("memory", usage);
      return;
    }
    const scope = scopeRaw && validScopes.has(scopeRaw) ? scopeRaw : undefined;
    if (scopeRaw && !validScopes.has(scopeRaw)) {
      commandError("memory", usage);
      return;
    }
    const resolvedScope = scope === "all" ? undefined : (scope as MemoryScope);
    const rows = archived ? await ops.listArchived(resolvedScope) : await ops.list(resolvedScope);
    if (rows.length === 0) {
      printDim(t(archived ? "cli.memory.archive.none" : "cli.memory.none"));
      return;
    }
    const out: CliOutput = json ? createJsonOutput() : createTextOutput();
    const tableRows = rows.slice(0, 50).map(toTableRow);
    out.addTable(json ? tableRows : fitFlexColumn(tableRows, "content"));
    const rendered = out.render();
    if (rendered) printDim(rendered);
    return;
  }

  if (subcommand === "restore") {
    const ids = rest;
    if (ids.length === 0 || ids.some((token) => token.startsWith("--"))) {
      commandError("memory", formatUsage("acolyte memory restore <id>..."));
      return;
    }
    const restored = await ops.restore(ids);
    if (restored.length === 0) {
      printDim(t("cli.memory.restore.none", { ids: ids.join(", ") }));
      return;
    }
    printDim(t("cli.memory.restored", { count: restored.length, ids: restored.map((e) => e.id).join(", ") }));
    return;
  }

  if (subcommand === "add") {
    let scope: "user" | "project" = "user";
    const contentParts: string[] = [];
    for (const token of rest) {
      if (token === "--project") {
        scope = "project";
        continue;
      }
      if (token === "--user") {
        scope = "user";
        continue;
      }
      contentParts.push(token);
    }
    const content = contentParts.join(" ").trim();
    if (!content) {
      commandError("memory", formatUsage("acolyte memory add [--user|--project] <memory text>"));
      return;
    }
    const entry = await ops.add(content, scope);
    printDim(t("cli.memory.saved", { scope, id: entry.id }));
    return;
  }

  commandError("memory");
}
