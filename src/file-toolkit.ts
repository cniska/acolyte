import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { appConfig } from "./app-config";
import {
  deleteTextFile,
  editCode,
  editFile,
  findFiles,
  readSnippets,
  scanCode,
  searchFiles,
  writeTextFile,
} from "./file-ops";
import { t } from "./i18n";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import {
  emitFindSummary,
  emitSearchSummary,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryEntries,
  TOOL_OUTPUT_LIMITS,
} from "./tool-output-format";

const WRITE_TOOL_PREVIEW_MAX_LINES = Number.POSITIVE_INFINITY;

function diffTotals(rawResult: string): { files: number; added: number; removed: number } {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const line of rawResult.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }
  return { files, added, removed };
}

function emitDiffSummaryHeader(
  toolName: "edit-file" | "edit-code" | "create-file",
  label: string,
  path: string,
  rawResult: string,
  onOutput: ToolkitInput["onOutput"],
  toolCallId: string,
): void {
  const { files, added, removed } = diffTotals(rawResult);
  const touchedFiles = files > 0 ? files : 1;
  onOutput({
    toolName,
    content: { kind: "edit-header", label, path, files: touchedFiles, added, removed },
    toolCallId,
  });
}

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

function formatDeletePaths(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0] ?? "";
  const shown = paths.slice(0, 3).join(", ");
  const remaining = paths.length - Math.min(paths.length, 3);
  return remaining > 0 ? `${shown} (+${remaining})` : shown;
}

type ReadPathInput = { path: string; start?: number; end?: number };
type NormalizedReadEntry = { path: string; start?: string; end?: string };

function normalizeReadEntries(paths: ReadPathInput[]): NormalizedReadEntry[] {
  const deduped = new Map<string, NormalizedReadEntry>();
  for (const entry of paths) {
    const path = entry.path.trim();
    if (path.length === 0) continue;
    const start = entry.start != null ? String(entry.start) : undefined;
    const end = entry.end != null ? String(entry.end) : undefined;
    const key = `${path}\u0000${start ?? ""}\u0000${end ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, { path, start, end });
  }
  return Array.from(deduped.values());
}

function createFindFilesTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "find-files",
    label: t("tool.label.find"),
    category: "search",
    permissions: ["read"],
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `search-files` instead.",
    instruction:
      "Use `find-files` to locate files by name or path pattern. Always pass `patterns` as an array (e.g. [`api.ts`, `store.ts`]).",
    inputSchema: z.object({
      patterns: z.array(z.string().min(1)).min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("find-files"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "find-files", toolInput, async (toolCallId) => {
        const maxResults = toolInput.maxResults ?? 40;
        const count = toolInput.patterns.length;
        const baseBudget = appConfig.agent.toolOutputBudget.findFiles;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const result = compactToolOutput(await findFiles(workspace, toolInput.patterns, maxResults), budget);
        const paths = findResultPaths(result);
        emitFindSummary(
          paths,
          toolInput.patterns,
          t("tool.label.find"),
          onOutput,
          toolCallId,
          TOOL_OUTPUT_LIMITS.files,
          workspace,
        );
        return {
          kind: "find-files",
          scope: "workspace",
          patterns: toolInput.patterns,
          matches: paths.length,
          paths,
          output: result,
        };
      });
    },
  });
}

function createSearchFilesTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "search-files",
    label: t("tool.label.search"),
    category: "search",
    permissions: ["read"],
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `find-files` instead.",
    instruction:
      "Use `search-files` to search file contents by text or regex. Batch related queries via `patterns` and scope with `paths` when you know the target area. If the needed text is already visible in `read-file`, edit from that evidence instead of searching the same file again. For one named file with a repeated literal replacement, do not use `search-files`; read the file once and make one consolidated `edit-file` call. For a multi-file rename or repeated replacement, if a named file has separated occurrences you have not yet anchored to exact snippets, run one scoped `search-files` on that file before `edit-file` so you can batch small exact edits instead of guessing a larger `find` block. When building an `edit-file` call, every `find` snippet must come from the current `read-file` text or scoped `search-files` hits for that file; do not invent old lines that are not present. When fixing a visible path or link, keep the local reference style from the target file.",
    inputSchema: z
      .object({
        pattern: z.string().min(1).optional(),
        patterns: z.array(z.string().min(1)).min(1).optional(),
        paths: z.array(z.string().min(1)).min(1).optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
      })
      .refine((input) => Boolean(input.pattern) || Boolean(input.patterns && input.patterns.length > 0), {
        message: "Provide pattern or patterns",
        path: ["patterns"],
      }),
    outputSchema: z.object({
      kind: z.literal("search-files"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      entries: z.array(z.object({ path: z.string().min(1), hits: z.array(z.string().min(1)) })),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "search-files", toolInput, async (toolCallId) => {
        const maxResults = toolInput.maxResults ?? 20;
        const patterns =
          toolInput.patterns && toolInput.patterns.length > 0
            ? toolInput.patterns
            : toolInput.pattern
              ? [toolInput.pattern]
              : [];
        const result = compactToolOutput(
          await searchFiles(workspace, patterns, maxResults, toolInput.paths),
          appConfig.agent.toolOutputBudget.searchFiles,
        );
        const summaryEntries = searchResultSummaryEntries(result, patterns);
        emitSearchSummary(
          summaryEntries,
          patterns,
          toolInput.paths,
          t("tool.label.search"),
          onOutput,
          toolCallId,
          TOOL_OUTPUT_LIMITS.files,
          workspace,
        );
        return {
          kind: "search-files",
          scope: toolInput.paths && toolInput.paths.length > 0 ? "paths" : "workspace",
          patterns,
          matches: summaryEntries.length,
          entries: summaryEntries,
          output: result,
        };
      });
    },
  });
}

function createScanCodeTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "scan-code",
    label: t("tool.label.review"),
    category: "search",
    permissions: ["read"],
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of ast-grep patterns with `$VAR` metavariables (e.g. [`export function $NAME($$$PARAMS)`, `import $SPEC from $MOD`]).",
    instruction:
      "Use `scan-code` for AST pattern matching. Always pass `paths` and `patterns` as arrays. Batch multiple files and patterns in one call (e.g. paths=[`src/a.ts`, `src/b.ts`], patterns=[`export function $NAME`, `import $SPEC from $MOD`]). Metavariable names (`$NAME`, `$ARG`) are wildcards — they match any node, not literal text. Use it to map rename/refactor targets before `edit-code`, not for plain text replacements or post-edit reassurance on a bounded named-file task. For keyword or regex searches prefer `search-files`.",
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
          const shown = unique.slice(0, TOOL_OUTPUT_LIMITS.inlineFiles);
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
        const result = compactToolOutput(
          await scanCode({
            workspace,
            paths,
            pattern: toolInput.patterns,
            language: toolInput.language,
            maxResults: toolInput.maxResults ?? 50,
          }),
          budget,
        );
        return { kind: "scan-code", paths, patterns: toolInput.patterns, output: result };
      });
    },
  });
}

function createReadFileTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "read-file",
    label: t("tool.label.read"),
    category: "read",
    permissions: ["read"],
    description:
      "Read one or more text files. Always pass `paths` as an array of {path, start?, end?} objects, even for a single file. Omit start/end to read the entire file (preferred). Only use line ranges for files over 500 lines. Never re-read a file you already have. Batch multiple files only while discovering scope or comparing targets.",
    instruction:
      "Use `read-file` to inspect code before editing. Read whole files by default and use start/end only for very large files. Batch reads while discovering scope; once you are editing named targets, read each target separately right before its edit, then continue directly to `edit-file` or `edit-code`. For one named file with a repeated literal replacement, read it once, compute the edits from that text, and do not re-read the same file unless the edit fails or the direct read output was truncated and you need the remaining ranges.",
    inputSchema: z.object({
      paths: z
        .array(
          z
            .object({
              path: z.string().min(1),
              start: z.number().int().min(1).optional(),
              end: z.number().int().min(1).optional(),
            })
            .refine((entry) => entry.start === undefined || entry.end === undefined || entry.start <= entry.end, {
              message: "start must be less than or equal to end",
              path: ["end"],
            }),
        )
        .min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("read-file"),
      paths: z.array(z.object({ path: z.string().min(1), start: z.string().optional(), end: z.string().optional() })),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "read-file", toolInput, async (toolCallId) => {
        const entries = normalizeReadEntries(toolInput.paths);
        if (entries.length === 0) throw new Error("Read requires at least one non-empty path");
        const unique = Array.from(new Set(entries.map((entry) => toDisplayPath(entry.path, workspace))));
        if (unique.length > 0) {
          const shown = unique.slice(0, TOOL_OUTPUT_LIMITS.inlineFiles);
          const remaining = unique.length - shown.length;
          onOutput({
            toolName: "read-file",
            content: {
              kind: "file-header",
              label: t("tool.label.read"),
              count: unique.length,
              targets: shown,
              omitted: remaining > 0 ? remaining : undefined,
            },
            toolCallId,
          });
        }
        const baseBudget = appConfig.agent.toolOutputBudget.read;
        const count = entries.length;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const result = compactToolOutput(await readSnippets(workspace, entries), budget);
        return { kind: "read-file", paths: entries, output: result };
      });
    },
  });
}

function createEditFileTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  const outputSchema = z.object({
    kind: z.literal("edit-file"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "edit-file",
    label: t("tool.label.edit"),
    category: "write",
    permissions: ["read", "write"],
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `read-file` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `create-file`. For code renames or structural edits use `edit-code`.",
    instruction:
      "Use `edit-file` for text edits. For small visible changes, prefer {find, replace} where `find` is the exact changed line or the smallest unique snippet from the latest direct `read-file` of that file. Keep anchors tight, keep line-range edits to the changed lines when possible, and preserve nearby path or link style. When changing multiple places in one file, use several small exact edits in one call rather than one oversized `find` block that spans distant locations. The `edit-file` result already includes a diff preview. If that preview shows the requested bounded change, stop instead of re-reading, searching, reviewing, or editing that same file again in work mode. For bounded 'each'/'every'/'all' replacements in one named file, use the latest file text to collect all visible requested occurrences into the same `edit-file` call whenever possible. If the same requested literal appears in multiple visible locations, include every visible location in that one call rather than editing only the first contiguous block. Completion means no requested matches remain in that file, not just that one edit succeeded. For larger block changes use {startLine, endLine, replace} with 1-based line numbers from the latest direct `read-file`; `replace` is only the new text for that region. Batch multiple edits to the same file into one call. If the change is a repeated plain-text rewrite in one known file, keep using one consolidated `edit-file` call. Switch to `edit-code` only for real AST-aware refactors or structural code rewrites.",
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z
        .array(
          z.union([
            z.object({ find: z.string().min(1), replace: z.string() }),
            z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1), replace: z.string() }),
          ]),
        )
        .min(1),
    }),
    outputSchema,
    execute: async (toolInput) => {
      return runTool(session, "edit-file", toolInput, async (toolCallId) => {
        const rawResult = await editFile({
          workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        emitDiffSummaryHeader("edit-file", t("tool.label.edit"), toolInput.path, rawResult, onOutput, toolCallId);
        for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
          onOutput({ toolName: "edit-file", content, toolCallId });
        const totals = diffTotals(rawResult);
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
        return {
          kind: "edit-file",
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          output: result,
        };
      });
    },
  });
}

function createEditCodeTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  const outputSchema = z.object({
    kind: z.literal("edit-code"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "edit-code",
    label: t("tool.label.edit"),
    category: "write",
    permissions: ["read", "write"],
    description:
      "Edit code with AST pattern matching. Pass `edits` as [{pattern, replacement}] using `$VAR` metavariables (e.g. pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`). `path` must be a specific file, not '.' or a directory. For non-code files use `edit-file`.",
    instruction:
      "Use `edit-code` for AST-aware rename/refactor work or structural code rewrites with AST `edits` array. Do not use plain text snippets as AST patterns, and do not use `edit-code` for markdown, docs, or repeated plain-text replacements in one known file. `path` must be a concrete file path (not `.` or a directory), and you should read that file directly right before editing it. The `edit-code` result already includes a diff preview. If that preview shows the requested bounded change, stop instead of re-reading, searching, or reviewing the same file again in work mode. Prefer `edit-file` for single-location text edits and for repeated text replacements within one file.",
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z
        .array(
          z.object({
            pattern: z.string().min(1),
            replacement: z.string(),
          }),
        )
        .min(1),
    }),
    outputSchema,
    execute: async (toolInput) => {
      return runTool(session, "edit-code", toolInput, async (toolCallId) => {
        const rawResult = await editCode({
          workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        emitDiffSummaryHeader("edit-code", t("tool.label.edit"), toolInput.path, rawResult, onOutput, toolCallId);
        for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
          onOutput({ toolName: "edit-code", content, toolCallId });
        const totals = diffTotals(rawResult);
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.astEdit);
        return {
          kind: "edit-code",
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          output: result,
        };
      });
    },
  });
}

function createCreateFileTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "create-file",
    label: t("tool.label.create"),
    category: "write",
    permissions: ["write"],
    description:
      "Create a new file with full content. For editing existing files, use `edit-file` or `edit-code` instead.",
    instruction: "For new files, call `create-file` with full content directly.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    outputSchema: z.object({
      kind: z.literal("create-file"),
      path: z.string().min(1),
      files: z.number().int().nonnegative(),
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "create-file", toolInput, async (toolCallId) => {
        const rawResult = await writeTextFile({
          workspace,
          path: toolInput.path,
          content: toolInput.content,
          overwrite: true,
        });
        emitDiffSummaryHeader("create-file", t("tool.label.create"), toolInput.path, rawResult, onOutput, toolCallId);
        for (const content of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES))
          onOutput({ toolName: "create-file", content, toolCallId });
        const totals = diffTotals(rawResult);
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.create);
        return {
          kind: "create-file",
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          output: result,
        };
      });
    },
  });
}

function createDeleteFileTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;
  return createTool({
    id: "delete-file",
    label: t("tool.label.delete"),
    category: "write",
    permissions: ["write"],
    description: "Delete a file from the repository.",
    instruction:
      "Use `delete-file` to remove files from the repository. Pass `paths` as an array and batch related deletes in one call.",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("delete-file"),
      paths: z.array(z.string().min(1)),
      deleted: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "delete-file", toolInput, async (toolCallId) => {
        const paths = normalizeUniquePaths(toolInput.paths);
        const deleteDetail = paths.length > 0 ? formatDeletePaths(paths) : undefined;
        onOutput({
          toolName: "delete-file",
          content: { kind: "tool-header", label: t("tool.label.delete"), detail: deleteDetail },
          toolCallId,
        });
        const resultParts: string[] = [];
        for (const path of paths) {
          const rawResult = await deleteTextFile({ workspace, path });
          resultParts.push(rawResult);
        }
        const rawResult = resultParts.join("\n\n");
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
        return { kind: "delete-file", paths, deleted: paths.length, output: result };
      });
    },
  });
}

export function createFileToolkit(input: ToolkitInput) {
  return {
    findFiles: createFindFilesTool(input),
    searchFiles: createSearchFilesTool(input),
    scanCode: createScanCodeTool(input),
    readFile: createReadFileTool(input),
    editFile: createEditFileTool(input),
    editCode: createEditCodeTool(input),
    createFile: createCreateFileTool(input),
    deleteFile: createDeleteFileTool(input),
  };
}
