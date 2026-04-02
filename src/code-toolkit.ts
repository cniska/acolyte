import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { editCodeEditSchema } from "./code-contract";
import { editCode, type ScanCodeResult, scanCode } from "./code-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { diffSummaryParts, emitParts } from "./tool-output-format";
import { numberedUnifiedDiffLines, summarizeUnifiedDiff } from "./tool-output-parse";

function normalizeUniquePaths(paths: string[]): string[] {
  const normalized = paths.map((path) => path.trim()).filter((path) => path.length > 0);
  return Array.from(new Set(normalized));
}

function toDisplayPath(path: string, workspace?: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("./")) return trimmed.slice(2);
  if (!workspace || !isAbsolute(trimmed)) return trimmed;
  const rel = relative(workspace, trimmed).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return trimmed;
  return rel || trimmed;
}

function formatScanCodeResult(result: ScanCodeResult): string {
  const lines: string[] = [`scanned=${result.scanned} matches=${result.matches}`];
  const multi = result.patterns.length > 1;
  for (const patternResult of result.patterns) {
    if (multi) lines.push(`--- pattern: ${patternResult.pattern} ---`);
    for (const match of patternResult.matches) {
      const truncated = match.text.length > 80 ? `${match.text.slice(0, 77)}...` : match.text;
      const captureStr =
        Object.keys(match.captures).length > 0
          ? `  {${Object.entries(match.captures)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ")}}`
          : "";
      const prefix = match.enclosingSymbol
        ? `${match.path}:${match.line}:[${match.enclosingSymbol}] `
        : `${match.path}:${match.line}: `;
      lines.push(`${prefix}${truncated}${captureStr}`.trimEnd());
    }
    if (multi && patternResult.matches.length === 0) lines.push("No matches.");
  }
  if (!multi && result.matches === 0) lines.push("No matches.");
  return lines.join("\n");
}

function createScanCodeTool(input: ToolkitInput) {
  return createTool({
    id: "code-scan",
    toolkit: "code",
    category: "search",
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of structural queries.",
    instruction: [
      "Use `code-scan` for AST pattern search.",
      "Pass `paths` and `patterns` as arrays; batch related scans.",
      "Use it to map structural targets before `code-edit`.",
      "For plain text/regex searches, use `file-search`.",
      "Matches include `enclosingSymbol`; reuse it as `withinSymbol` in follow-up `code-edit`.",
    ].join(" "),
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
      patterns: z.array(z.string().min(1)).min(1),
      language: z.string().optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("code-scan"),
      paths: z.array(z.string().min(1)),
      patterns: z.array(z.string().min(1)),
      output: z.string(),
    }),
    outputBudget: { maxChars: 2_400, maxLines: 80 },
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "code-scan", toolCallId, toolInput, async (callId) => {
        const paths = normalizeUniquePaths(toolInput.paths);
        const unique = Array.from(new Set(paths.map((path) => toDisplayPath(path, input.workspace))));
        if (unique.length > 0) {
          const shown = unique.slice(0, 4);
          const remaining = unique.length - shown.length;
          input.onOutput({
            toolName: "code-scan",
            content: {
              kind: "file-header",
              labelKey: "tool.label.code_scan",
              count: unique.length,
              targets: shown,
              omitted: remaining > 0 ? remaining : undefined,
            },
            toolCallId: callId,
          });
        }
        const rawScan = await scanCode({
          workspace: input.workspace,
          paths,
          pattern: toolInput.patterns,
          language: toolInput.language,
          maxResults: toolInput.maxResults ?? 50,
        });
        return { kind: "code-scan", paths, patterns: toolInput.patterns, output: formatScanCodeResult(rawScan) };
      });
    },
  });
}

function createEditCodeTool(input: ToolkitInput) {
  const outputSchema = z.object({
    kind: z.literal("code-edit"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    edits: z.number().int().nonnegative(),
    affectedSymbols: z.array(z.string()),
    output: z.string(),
  });
  return createTool({
    id: "code-edit",
    toolkit: "code",
    category: "write",
    description:
      'Edit code structurally with AST-aware operations. Pass `edits` as operation objects like {op:"rename", from, to, withinSymbol?, target?} or {op:"replace", rule, replacement, within?, withinSymbol?}. For `replace`, `rule` may be a string/pattern object shorthand or a recursive ast-grep rule object. `path` may be a file or directory (`.` for workspace-wide). For non-code files use `file-edit`.',
    instruction: [
      "Use `code-edit` for AST-aware refactors; use `file-edit` for plain text edits.",
      "Prefer explicit `rename` or `replace` operations.",
      "For ambiguous local/member renames, set `target` to `local` or `member`.",
      "Use `withinSymbol` to keep edits scoped.",
      "Set `scope` to `workspace` to apply edits across all project files.",
      "Read the target file directly before editing.",
      "If `code-edit` reports no matches, refine scope/rule from current file evidence instead of broadening blindly.",
      "Use the diff preview to confirm bounded changes and stop.",
    ].join(" "),
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z.array(editCodeEditSchema).min(1),
    }),
    outputSchema,
    outputBudget: { maxChars: 1_400, maxLines: 60 },
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "code-edit", toolCallId, toolInput, async (callId) => {
        const editResult = await editCode({
          workspace: input.workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        const summaryParts = diffSummaryParts(toolInput.path, editResult.output, "tool.label.code_edit");
        const diffParts = numberedUnifiedDiffLines(editResult.output);
        emitParts(summaryParts, "code-edit", input.onOutput, callId);
        emitParts(diffParts, "code-edit", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(editResult.output);
        return {
          kind: "code-edit",
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          matches: editResult.matches,
          edits: editResult.edits,
          affectedSymbols: editResult.affectedSymbols,
          output: editResult.output,
        };
      });
    },
  });
}

export function createCodeToolkit(input: ToolkitInput) {
  return {
    scanCode: createScanCodeTool(input),
    editCode: createEditCodeTool(input),
  };
}
