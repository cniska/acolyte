import { hasBoolFlag, stripFlag } from "./cli-args";
import { formatUsage } from "./cli-help";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { truncateText } from "./compact-text";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { MemoryStore } from "./memory-store";

type MemoryModeDeps = {
  store: MemoryStore;
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export async function memoryMode(args: string[], deps: MemoryModeDeps): Promise<void> {
  const { store, hasHelpFlag, printDim, commandError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("memory");
    return;
  }
  const json = hasBoolFlag(args, "--json");
  const [subcommand, ...rest] = stripFlag(args, "--json");
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
    if (rows.length === 0) {
      printDim(t("cli.memory.none"));
      return;
    }
    const out: CliOutput = json ? createJsonOutput() : createTextOutput();
    out.addTable(
      rows.slice(0, 50).map((row) => ({
        id: row.id,
        content: truncateText(row.content, 80),
        time: formatRelativeTime(row.createdAt),
      })),
    );
    const rendered = out.render();
    if (rendered) printDim(rendered);
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
