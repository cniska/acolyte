import { z } from "zod";
import { subcommandHelp } from "./cli-command-registry";
import {
  displayPath,
  formatEditUpdateOutput,
  formatForTool,
  formatReadDetail,
  parseEditResult,
  showToolResult,
} from "./cli-format";
import { editFile, findFiles, readSnippet, searchFiles } from "./file-ops";
import { gitDiff, gitStatusShort } from "./git-ops";
import { t } from "./i18n";
import { runShellCommand } from "./shell-ops";
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
  if (clean.length < 3) throw new Error(t("cli.tool.edit.usage"));
  const [path, find, ...replaceParts] = clean;
  return editArgsSchema.parse({
    path,
    edits: [{ find, replace: replaceParts.join(" ") }],
    dryRun,
  });
}

function requireArg(rest: string[], usage: string): string {
  const value = rest.join(" ").trim();
  if (!value) {
    printError(usage);
    process.exitCode = 1;
  }
  return value;
}

export async function toolMode(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    subcommandHelp("tool");
    return;
  }
  try {
    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "find": {
        const pattern = requireArg(rest, t("cli.tool.find.usage"));
        if (!pattern) return;
        const result = await findFiles(process.cwd(), [pattern]);
        showToolResult("Find", formatForTool("find", result), "tool", pattern);
        return;
      }
      case "search": {
        const pattern = requireArg(rest, t("cli.tool.search.usage"));
        if (!pattern) return;
        const result = await searchFiles(process.cwd(), [pattern]);
        showToolResult("Search", formatForTool("search", result), "tool", pattern);
        return;
      }
      case "web": {
        const query = requireArg(rest, t("cli.tool.web.usage"));
        if (!query) return;
        const result = await searchWeb(query, 5);
        showToolResult("Web", result, "plain", query);
        return;
      }
      case "fetch": {
        const url = requireArg(rest, t("cli.tool.fetch.usage"));
        if (!url) return;
        const result = await fetchWeb(url, 5000);
        showToolResult("Fetch", result, "plain", url);
        return;
      }
      case "read": {
        const [pathInput, start, end] = rest;
        if (!pathInput) {
          printError(t("cli.tool.read.usage"));
          process.exitCode = 1;
          return;
        }
        const snippet = await readSnippet(process.cwd(), pathInput, start, end);
        showToolResult("Read", formatForTool("read", snippet), "plain", formatReadDetail(pathInput, start, end));
        return;
      }
      case "git-status": {
        const result = await gitStatusShort(process.cwd());
        showToolResult("Git Status", formatForTool("status", result), "tool");
        return;
      }
      case "git-diff": {
        const [pathInput, context] = rest;
        const ctxRaw = context ? Number.parseInt(context, 10) : undefined;
        const ctx = ctxRaw !== undefined && !Number.isNaN(ctxRaw) ? ctxRaw : 3;
        const result = await gitDiff(process.cwd(), pathInput, ctx);
        showToolResult("Diff", formatForTool("diff", result), "plain", pathInput ?? ".");
        return;
      }
      case "run": {
        const command = requireArg(rest, t("cli.tool.run.usage"));
        if (!command) return;
        const result = await runShellCommand(process.cwd(), command);
        showToolResult("Run", formatForTool("run", result), "plain", command);
        return;
      }
      case "edit": {
        let parsed: ReturnType<typeof parseEditArgs>;
        try {
          parsed = parseEditArgs(rest);
        } catch (error) {
          const message = error instanceof Error ? error.message : t("cli.tool.edit.invalid_args");
          printError(message.replace("/edit", "acolyte tool edit"));
          process.exitCode = 1;
          return;
        }
        const result = await editFile({ workspace: process.cwd(), ...parsed });
        const summary = parseEditResult(result);
        let rendered = false;
        if (summary) {
          const shownPath = displayPath(summary.path);
          if (summary.dryRun) {
            showToolResult(
              "Dry Run",
              `${t("unit.match", { count: summary.edits })} would be changed.`,
              "plain",
              shownPath,
            );
            rendered = true;
          } else {
            try {
              const diff = await gitDiff(process.cwd(), parsed.path, 1);
              showToolResult("Edit", formatEditUpdateOutput(summary.edits, diff), "diff", shownPath);
              rendered = true;
            } catch (error) {
              const message = error instanceof Error ? error.message : t("cli.tool.diff.unavailable");
              if (message.includes("outside repository")) {
                showToolResult(
                  "Edit",
                  `${t("unit.replacement", { count: summary.edits })} applied.`,
                  "plain",
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
        if (!rendered) showToolResult("Edit", result, "plain", parsed.path);
        return;
      }
      default:
        printError(t("cli.tool.usage"));
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t("cli.tool.failed");
    printError(message);
    process.exitCode = 1;
  }
}
