import { z } from "zod";
import { commandHelp } from "./cli-command-registry";
import {
  displayPath,
  formatEditUpdateOutput,
  formatForTool,
  formatReadDetail,
  parseEditResult,
  printToolOutput,
} from "./cli-format";
import { editFile, findFiles, readSnippet, searchFiles } from "./file-ops";
import { gitDiff, gitStatusShort } from "./git-ops";
import { t } from "./i18n";
import { runShellCommand } from "./shell-ops";
import { toolDefinitionsById } from "./tool-registry";
import { printError, printWarning } from "./ui";
import { fetchWeb, searchWeb } from "./web-ops";

const editArgsSchema = z.object({
  path: z.string().min(1),
  edits: z.array(z.object({ find: z.string().min(1), replace: z.string() })).min(1),
  dryRun: z.boolean(),
});

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h") || args.includes("help");
}

export function parseEditArgs(args: string[]): {
  path: string;
  edits: Array<{ find: string; replace: string }>;
  dryRun: boolean;
} {
  const dryRun = args.includes("--dry-run");
  const clean = args.filter((a) => a !== "--dry-run");
  if (clean.length < 3) throw new Error(t("cli.tool.edit-file.usage"));
  const [path, find, ...replaceParts] = clean;
  return editArgsSchema.parse({
    path,
    edits: [{ find, replace: replaceParts.join(" ") }],
    dryRun,
  });
}

function label(toolId: string): string {
  return toolDefinitionsById[toolId]?.label ?? toolId;
}

function requireArg(rest: string[], usage: string): string | null {
  const value = rest.join(" ").trim();
  if (value.length === 0) {
    printError(usage);
    process.exitCode = 1;
    return null;
  }
  return value;
}

type ToolHandler = (rest: string[]) => Promise<void>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  "find-files": async (rest) => {
    const pattern = requireArg(rest, t("cli.tool.find-files.usage"));
    if (!pattern) return;
    const result = await findFiles(process.cwd(), [pattern]);
    printToolOutput(label("find-files"), formatForTool("find", result), pattern);
  },
  "search-files": async (rest) => {
    const pattern = requireArg(rest, t("cli.tool.search-files.usage"));
    if (!pattern) return;
    const result = await searchFiles(process.cwd(), [pattern]);
    printToolOutput(label("search-files"), formatForTool("search", result), pattern);
  },
  "web-search": async (rest) => {
    const query = requireArg(rest, t("cli.tool.web-search.usage"));
    if (!query) return;
    const result = await searchWeb(query, 5);
    printToolOutput(label("web-search"), result, query);
  },
  "web-fetch": async (rest) => {
    const url = requireArg(rest, t("cli.tool.web-fetch.usage"));
    if (!url) return;
    const result = await fetchWeb(url, 5000);
    printToolOutput(label("web-fetch"), result, url);
  },
  "read-file": async (rest) => {
    const [pathInput, start, end] = rest;
    if (!pathInput) {
      printError(t("cli.tool.read-file.usage"));
      process.exitCode = 1;
      return;
    }
    const snippet = await readSnippet(process.cwd(), pathInput, start, end);
    printToolOutput(label("read-file"), formatForTool("read", snippet), formatReadDetail(pathInput, start, end));
  },
  "git-status": async () => {
    const result = await gitStatusShort(process.cwd());
    printToolOutput(label("git-status"), formatForTool("status", result));
  },
  "git-diff": async (rest) => {
    const [pathInput, context] = rest;
    const ctxRaw = context ? Number.parseInt(context, 10) : undefined;
    const ctx = ctxRaw !== undefined && !Number.isNaN(ctxRaw) ? ctxRaw : 3;
    const result = await gitDiff(process.cwd(), pathInput, ctx);
    printToolOutput(label("git-diff"), formatForTool("diff", result), pathInput ?? ".");
  },
  "run-command": async (rest) => {
    const command = requireArg(rest, t("cli.tool.run-command.usage"));
    if (!command) return;
    const result = await runShellCommand(process.cwd(), command);
    printToolOutput(label("run-command"), formatForTool("run", result), command);
  },
  "edit-file": async (rest) => {
    let parsed: ReturnType<typeof parseEditArgs>;
    try {
      parsed = parseEditArgs(rest);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("cli.tool.edit-file.invalid_args");
      printError(message.replace("/edit", "acolyte tool edit-file"));
      process.exitCode = 1;
      return;
    }
    const result = await editFile({ workspace: process.cwd(), ...parsed });
    const summary = parseEditResult(result);
    let rendered = false;
    if (summary) {
      const shownPath = displayPath(summary.path);
      if (summary.dryRun) {
        printToolOutput(
          label("edit-file"),
          `${t("unit.match", { count: summary.edits })} would be changed.`,
          shownPath,
        );
        rendered = true;
      } else {
        try {
          const diff = await gitDiff(process.cwd(), parsed.path, 1);
          printToolOutput(label("edit-file"), formatEditUpdateOutput(summary.edits, diff), shownPath);
          rendered = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : t("cli.tool.diff.unavailable");
          if (message.includes("outside repository")) {
            printToolOutput(
              label("edit-file"),
              `${t("unit.replacement", { count: summary.edits })} applied.`,
              shownPath,
            );
            rendered = true;
            printWarning(t("cli.tool.diff.unavailable.outside_repo"));
          } else {
            printWarning(message);
          }
        }
      }
    }
    if (!rendered) printToolOutput(label("edit-file"), result, parsed.path);
  },
};

const CLI_TOOL_IDS = Object.keys(TOOL_HANDLERS);

export async function toolMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    commandHelp("tool");
    return;
  }
  try {
    const [subcommand, ...rest] = args;
    const handler = subcommand ? TOOL_HANDLERS[subcommand] : undefined;
    if (!handler) {
      printError(t("cli.tool.usage"));
      process.exitCode = 1;
      return;
    }
    await handler(rest);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("cli.tool.failed");
    printError(message);
    process.exitCode = 1;
  }
}
