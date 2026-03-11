import { formatColumns, formatRelativeTime } from "./chat-format";
import { truncateText } from "./compact-text";
import { formatUsage } from "./cli-help";
import { t } from "./i18n";
import type { MemoryEntry } from "./memory-contract";
import type { MemoryStore } from "./memory-store";

type MemoryModeDeps = {
  store: MemoryStore;
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

function printMemoryRows(rows: readonly MemoryEntry[], printDim: (message: string) => void): void {
  if (rows.length === 0) {
    printDim(t("cli.memory.none"));
    return;
  }

  const formatted = rows
    .slice(0, 50)
    .map((row) => [row.id, truncateText(row.content, 80), formatRelativeTime(row.createdAt)]);
  for (const line of formatColumns(formatted)) {
    printDim(line);
  }
}

export async function memoryMode(args: string[], deps: MemoryModeDeps): Promise<void> {
  const { store, hasHelpFlag, printDim, commandError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("memory");
    return;
  }
  const [subcommand, ...rest] = args;
  const validScopes = new Set(["all", "user", "project"]);

  if (subcommand === "list" || !subcommand) {
    const scopeRaw = subcommand === "list" ? rest[0] : undefined;
    if (subcommand === "list" && rest.length > 1) {
      commandError("memory", formatUsage("acolyte memory list [all|user|project]"));
      return;
    }
    const scope = scopeRaw && validScopes.has(scopeRaw) ? scopeRaw : "all";
    if (scopeRaw && !validScopes.has(scopeRaw)) {
      commandError("memory", formatUsage("acolyte memory list [all|user|project]"));
      return;
    }
    const rows = await store.list(scope as "all" | "user" | "project");
    printMemoryRows(rows, printDim);
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
    const entry = await store.add(content, scope);
    printDim(t("cli.memory.saved", { scope, id: entry.id }));
    return;
  }

  commandError("memory");
}
