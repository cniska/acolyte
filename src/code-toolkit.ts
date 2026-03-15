import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { appConfig } from "./app-config";
import { editCodeEditSchema } from "./code-contract";
import { editCode, type ScanCodeResult, scanCode } from "./code-ops";
import { t } from "./i18n";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { createDiffSummaryEmitter, numberedUnifiedDiffLines, summarizeUnifiedDiff } from "./tool-output-format";

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
      lines.push(`${match.relPath}:${match.line}: ${truncated}${captureStr}`);
    }
    if (multi && patternResult.matches.length === 0) lines.push("No matches.");
  }
  if (!multi && result.matches === 0) lines.push("No matches.");
  return lines.join("\n");
}

function createScanCodeTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "scan-code",
    label: t("tool.label.review"),
    category: "search",
    permissions: ["read"],
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of structural queries.",
    instruction:
      "Use `scan-code` for AST pattern matching. Always pass `paths` and `patterns` as arrays. Batch multiple files and patterns in one call. Use it to map structural targets before `edit-code`, not for plain text replacements or post-edit reassurance on a bounded named-file task. For keyword or regex searches prefer `search-files`.",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
      patterns: z.array(z.string().min(1)).min(1),
      language: z.string().optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("scan-code"),
      paths: z.array(z.string().min(1)),
      patterns: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "scan-code", toolInput, async (toolCallId) => {
        const paths = normalizeUniquePaths(toolInput.paths);
        const unique = Array.from(new Set(paths.map((path) => toDisplayPath(path, workspace))));
        if (unique.length > 0) {
          const shown = unique.slice(0, 4);
          const remaining = unique.length - shown.length;
          onOutput({
            toolName: "scan-code",
            content: {
              kind: "file-header",
              label: t("tool.label.review"),
              count: unique.length,
              targets: shown,
              omitted: remaining > 0 ? remaining : undefined,
            },
            toolCallId,
          });
        }
        const baseBudget = appConfig.agent.toolOutputBudget.scanCode;
        const count = paths.length * toolInput.patterns.length;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const rawScan = await scanCode({
          workspace,
          paths,
          pattern: toolInput.patterns,
          language: toolInput.language,
          maxResults: toolInput.maxResults ?? 50,
        });
        const result = compactToolOutput(formatScanCodeResult(rawScan), budget);
        return { kind: "scan-code", paths, patterns: toolInput.patterns, output: result };
      });
    },
  });
}

function createEditCodeTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  const emitDiffSummaryHeader = createDiffSummaryEmitter({
    toolName: "edit-code",
    label: t("tool.label.edit"),
    onOutput,
  });
  const outputSchema = z.object({
    kind: z.literal("edit-code"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    edits: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "edit-code",
    label: t("tool.label.edit"),
    category: "write",
    permissions: ["read", "write"],
    description:
      'Edit code structurally with AST-aware operations. Pass `edits` as operation objects like {op:"rename", from, to, withinSymbol?} or {op:"replace", rule, replacement, within?, withinSymbol?}. For `replace`, `rule` may be a string/pattern object shorthand or a recursive ast-grep rule object. `path` must be a specific file, not \'.\' or a directory. For non-code files use `edit-file`.',
    instruction:
      'Use `edit-code` for AST-aware refactors or structural code rewrites. Prefer explicit operation objects. For identifier renames, use { op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }. For broader rewrites, use { op: "replace", rule, replacement, within?, withinSymbol? }. `rule` may be a pattern shorthand (`"console.log($ARG)"`), a structured pattern object ({ context, selector, strictness }), or a recursive ast-grep rule object ({ all, any, not, kind, regex, inside, has, pattern }). Use `any` when any one child rule may match, `all` when all child rules must match the same node, `inside` to restrict matches to an ancestor scope, `has` to require a descendant match, and `stopBy`/`field` only when you need relational scoping details. `path` must be a concrete file path, and you should read that file directly right before editing it. When the change must stay inside one named helper, declaration, or block, prefer `withinSymbol` with the enclosing name. If `edit-code` reports no AST matches, refine the rename scope or rule against the latest read-file text for that same file instead of broadening the rewrite to unrelated matches. The `edit-code` result already includes a diff preview. If that preview shows the requested bounded change, stop immediately instead of re-reading, searching, reviewing, or calling another write tool on that same file in work mode. Prefer `edit-file` for single-location text edits and repeated plain-text replacements within one file.',
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z.array(editCodeEditSchema).min(1),
    }),
    outputSchema,
    execute: async (toolInput) => {
      return runTool(session, "edit-code", toolInput, async (toolCallId) => {
        const editResult = await editCode({
          workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        emitDiffSummaryHeader(toolInput.path, editResult.output, toolCallId);
        for (const content of numberedUnifiedDiffLines(editResult.output))
          onOutput({ toolName: "edit-code", content, toolCallId });
        const totals = summarizeUnifiedDiff(editResult.output);
        const result = compactToolOutput(editResult.output, appConfig.agent.toolOutputBudget.astEdit);
        return {
          kind: "edit-code",
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          matches: editResult.matches,
          edits: editResult.edits,
          output: result,
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
