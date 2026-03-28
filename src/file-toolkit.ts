import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { deleteTextFile, editFile, findFiles, readFileContents, searchFiles, writeTextFile } from "./file-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { diffSummaryParts, emitParts, findSummaryParts, searchSummaryParts } from "./tool-output-format";
import {
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryStats,
  summarizeUnifiedDiff,
} from "./tool-output-parse";
import { TOOL_PROGRESS_LIMITS } from "./tool-policy";

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

function deduplicatePaths(paths: Array<{ path: string }>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const path = entry.path.trim();
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function createFindFilesTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "file-find",
    toolkit: "file",
    labelKey: "tool.label.file_find",
    category: "search",
    permissions: ["read"],
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `file-search` instead.",
    instruction:
      "Use `file-find` to locate files by name or path pattern. Always pass `patterns` as an array (e.g. [`api.ts`, `store.ts`]).",
    inputSchema: z.object({
      patterns: z.array(z.string().min(1)).min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("file-find"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-find", toolCallId, toolInput, async (callId) => {
        const maxResults = toolInput.maxResults ?? 40;
        const count = toolInput.patterns.length;
        const baseBudget = deps.outputBudget.findFiles;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const result = compactToolOutput(await findFiles(input.workspace, toolInput.patterns, maxResults), budget);
        const paths = findResultPaths(result);
        emitParts(
          findSummaryParts(paths, toolInput.patterns, "tool.label.file_find"),
          "file-find",
          input.onOutput,
          callId,
        );
        return {
          kind: "file-find",
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

function createSearchFilesTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "file-search",
    toolkit: "file",
    labelKey: "tool.label.file_search",
    category: "search",
    permissions: ["read"],
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `file-find` instead.",
    instruction: [
      "Use `file-search` to search file contents by text or regex.",
      "Batch related queries via `patterns` and scope with `paths` when you know the target area.",
      "If the needed text is already visible in `file-read`, edit from that evidence instead of searching the same file again.",
      "For one named file with a repeated literal replacement, do not use `file-search`; read the file once and make one consolidated `file-edit` call.",
      "For a multi-file rename or repeated replacement, if a named file has separated occurrences you have not yet anchored to exact snippets, run one scoped `file-search` on that file before `file-edit` so you can batch small exact edits instead of guessing a larger `find` block.",
      "When building a `file-edit` call, every `find` snippet must come from the current `file-read` text or scoped `file-search` hits for that file; do not invent old lines that are not present.",
      "When fixing a visible path or link, keep the local reference style from the target file.",
    ].join(" "),
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
      kind: z.literal("file-search"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      entries: z.array(z.object({ path: z.string().min(1), hits: z.array(z.string().min(1)) })),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-search", toolCallId, toolInput, async (callId) => {
        const maxResults = toolInput.maxResults ?? 20;
        const patterns =
          toolInput.patterns && toolInput.patterns.length > 0
            ? toolInput.patterns
            : toolInput.pattern
              ? [toolInput.pattern]
              : [];
        const result = compactToolOutput(
          await searchFiles(input.workspace, patterns, maxResults, toolInput.paths),
          deps.outputBudget.searchFiles,
        );
        const summaryStats = searchResultSummaryStats(result, patterns);
        emitParts(
          searchSummaryParts(summaryStats, patterns, toolInput.paths, "tool.label.file_search", input.workspace),
          "file-search",
          input.onOutput,
          callId,
        );
        return {
          kind: "file-search",
          scope: toolInput.paths && toolInput.paths.length > 0 ? "paths" : "workspace",
          patterns,
          matches: summaryStats.files,
          entries: [],
          output: result,
        };
      });
    },
  });
}

function createReadFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "file-read",
    toolkit: "file",
    labelKey: "tool.label.file_read",
    category: "read",
    permissions: ["read"],
    description:
      "Read one or more text files. Pass `paths` as an array of {path} objects. Never re-read a file you already have.",
    instruction:
      "Use `file-read` to inspect code before editing. Batch reads while discovering scope; once you are editing named targets, read each target separately right before its edit, then continue directly to `file-edit` or `code-edit`.",
    inputSchema: z.object({
      paths: z.array(z.object({ path: z.string().min(1) })).min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-read"),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-read", toolCallId, toolInput, async (callId) => {
        const paths = deduplicatePaths(toolInput.paths);
        if (paths.length === 0) throw new Error("Read requires at least one non-empty path");
        const displayPaths = paths.map((p) => toDisplayPath(p, input.workspace));
        const shown = displayPaths.slice(0, TOOL_PROGRESS_LIMITS.inlineFiles);
        const remaining = displayPaths.length - shown.length;
        input.onOutput({
          toolName: "file-read",
          content: {
            kind: "file-header",
            labelKey: "tool.label.file_read",
            count: displayPaths.length,
            targets: shown,
            omitted: remaining > 0 ? remaining : undefined,
          },
          toolCallId: callId,
        });
        const raw = await readFileContents(input.workspace, paths, deps.outputBudget.read.maxLines);
        const output = compactToolOutput(raw, deps.outputBudget.read);
        return { kind: "file-read", paths, output };
      });
    },
  });
}

function createEditFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  const outputSchema = z.object({
    kind: z.literal("file-edit"),
    path: z.string().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "file-edit",
    toolkit: "file",
    labelKey: "tool.label.file_edit",
    category: "write",
    permissions: ["read", "write"],
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `file-read` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `file-create`. For code renames or structural edits use `code-edit`.",
    instruction: [
      "Use `file-edit` for text edits.",
      "For small visible changes, prefer {find, replace} where `find` is the exact changed line or the smallest unique snippet from the latest direct `file-read` of that file.",
      "Keep anchors tight, keep line-range edits to the changed lines when possible, and preserve nearby path or link style.",
      "When changing multiple places in one file, use several small exact edits in one call rather than one oversized `find` block that spans distant locations.",
      "The `file-edit` result already includes a diff preview.",
      "If that preview shows the requested bounded change, stop instead of re-reading, searching, reviewing, or editing that same file again in work mode.",
      "For bounded 'each'/'every'/'all' replacements in one named file, use the latest file text to collect all visible requested occurrences into the same `file-edit` call whenever possible.",
      "If the same requested literal appears in multiple visible locations, include every visible location in that one call rather than editing only the first contiguous block.",
      "Completion means no requested matches remain in that file, not just that one edit succeeded.",
      "For larger block changes use {startLine, endLine, replace} with 1-based line numbers from the latest direct `file-read`; `replace` is only the new text for that region.",
      "Batch multiple edits to the same file into one call.",
      "If the change is a repeated plain-text rewrite in one known file, keep using one consolidated `file-edit` call.",
      "Switch to `code-edit` only for real AST-aware refactors or structural code rewrites.",
    ].join(" "),
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-edit", toolCallId, toolInput, async (callId) => {
        const rawResult = await editFile({
          workspace: input.workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        emitParts(
          diffSummaryParts(toolInput.path, rawResult, "tool.label.file_edit"),
          "file-edit",
          input.onOutput,
          callId,
        );
        emitParts(numberedUnifiedDiffLines(rawResult), "file-edit", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.edit);
        return {
          kind: "file-edit",
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

function createCreateFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "file-create",
    toolkit: "file",
    labelKey: "tool.label.file_create",
    category: "write",
    permissions: ["write"],
    description:
      "Create a new file with full content. For editing existing files, use `file-edit` or `code-edit` instead.",
    instruction: "For new files, call `file-create` with full content directly.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    outputSchema: z.object({
      kind: z.literal("file-create"),
      path: z.string().min(1),
      files: z.number().int().nonnegative(),
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-create", toolCallId, toolInput, async (callId) => {
        const rawResult = await writeTextFile({
          workspace: input.workspace,
          path: toolInput.path,
          content: toolInput.content,
          overwrite: true,
        });
        emitParts(
          diffSummaryParts(toolInput.path, rawResult, "tool.label.file_create"),
          "file-create",
          input.onOutput,
          callId,
        );
        emitParts(numberedUnifiedDiffLines(rawResult), "file-create", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.create);
        return {
          kind: "file-create",
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

function createDeleteFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "file-delete",
    toolkit: "file",
    labelKey: "tool.label.file_delete",
    category: "write",
    permissions: ["write"],
    description: "Delete a file from the repository.",
    instruction:
      "Use `file-delete` to remove files from the repository. Pass `paths` as an array and batch related deletes in one call.",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-delete"),
      paths: z.array(z.string().min(1)),
      deleted: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-delete", toolCallId, toolInput, async (callId) => {
        const paths = normalizeUniquePaths(toolInput.paths);
        const deleteDetail = paths.length > 0 ? formatDeletePaths(paths) : undefined;
        input.onOutput({
          toolName: "file-delete",
          content: { kind: "tool-header", labelKey: "tool.label.file_delete", detail: deleteDetail },
          toolCallId: callId,
        });
        const resultParts: string[] = [];
        for (const path of paths) {
          const rawResult = await deleteTextFile({ workspace: input.workspace, path });
          resultParts.push(rawResult);
        }
        const rawResult = resultParts.join("\n\n");
        const result = compactToolOutput(rawResult, deps.outputBudget.edit);
        return { kind: "file-delete", paths, deleted: paths.length, output: result };
      });
    },
  });
}

export function createFileToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    findFiles: createFindFilesTool(deps, input),
    searchFiles: createSearchFilesTool(deps, input),
    readFile: createReadFileTool(deps, input),
    editFile: createEditFileTool(deps, input),
    createFile: createCreateFileTool(deps, input),
    deleteFile: createDeleteFileTool(deps, input),
  };
}
