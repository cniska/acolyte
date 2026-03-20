import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { deleteTextFile, editFile, findFiles, readSnippets, searchFiles, writeTextFile } from "./file-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import {
  createDiffSummaryEmitter,
  emitFindSummary,
  emitSearchSummary,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryEntries,
  summarizeUnifiedDiff,
  TOOL_OUTPUT_LIMITS,
} from "./tool-output-format";

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

function createFindFilesTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "find-files",
    labelKey: "find",
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "find-files", toolCallId, toolInput, async (callId) => {
        const maxResults = toolInput.maxResults ?? 40;
        const count = toolInput.patterns.length;
        const baseBudget = deps.outputBudget.findFiles;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const result = compactToolOutput(await findFiles(input.workspace, toolInput.patterns, maxResults), budget);
        const paths = findResultPaths(result);
        emitFindSummary(
          paths,
          toolInput.patterns,
          "find",
          input.onOutput,
          callId,
          TOOL_OUTPUT_LIMITS.files,
          input.workspace,
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

function createSearchFilesTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "search-files",
    labelKey: "search",
    category: "search",
    permissions: ["read"],
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `find-files` instead.",
    instruction: [
      "Use `search-files` to search file contents by text or regex.",
      "Batch related queries via `patterns` and scope with `paths` when you know the target area.",
      "If the needed text is already visible in `read-file`, edit from that evidence instead of searching the same file again.",
      "For one named file with a repeated literal replacement, do not use `search-files`; read the file once and make one consolidated `edit-file` call.",
      "For a multi-file rename or repeated replacement, if a named file has separated occurrences you have not yet anchored to exact snippets, run one scoped `search-files` on that file before `edit-file` so you can batch small exact edits instead of guessing a larger `find` block.",
      "When building an `edit-file` call, every `find` snippet must come from the current `read-file` text or scoped `search-files` hits for that file; do not invent old lines that are not present.",
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
      kind: z.literal("search-files"),
      scope: z.string().min(1),
      patterns: z.array(z.string().min(1)),
      matches: z.number().int().nonnegative(),
      entries: z.array(z.object({ path: z.string().min(1), hits: z.array(z.string().min(1)) })),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "search-files", toolCallId, toolInput, async (callId) => {
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
        const summaryEntries = searchResultSummaryEntries(result, patterns);
        emitSearchSummary(
          summaryEntries,
          patterns,
          toolInput.paths,
          "search",
          input.onOutput,
          callId,
          TOOL_OUTPUT_LIMITS.files,
          input.workspace,
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

function createReadFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "read-file",
    labelKey: "read",
    category: "read",
    permissions: ["read"],
    description:
      "Read one or more text files. Always pass `paths` as an array of {path, start?, end?} objects, even for a single file. Omit start/end to read the entire file (preferred). Only use line ranges for files over 500 lines. Never re-read a file you already have. Batch multiple files only while discovering scope or comparing targets.",
    instruction: [
      "Use `read-file` to inspect code before editing.",
      "Read whole files by default and use start/end only for very large files.",
      "Batch reads while discovering scope; once you are editing named targets, read each target separately right before its edit, then continue directly to `edit-file` or `edit-code`.",
      "For one named file with a repeated literal replacement, read it once, compute the edits from that text, and do not re-read the same file unless the edit fails or the direct read output was truncated and you need the remaining ranges.",
    ].join(" "),
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "read-file", toolCallId, toolInput, async (callId) => {
        const entries = normalizeReadEntries(toolInput.paths);
        if (entries.length === 0) throw new Error("Read requires at least one non-empty path");
        const unique = Array.from(new Set(entries.map((entry) => toDisplayPath(entry.path, input.workspace))));
        if (unique.length > 0) {
          const shown = unique.slice(0, TOOL_OUTPUT_LIMITS.inlineFiles);
          const remaining = unique.length - shown.length;
          input.onOutput({
            toolName: "read-file",
            content: {
              kind: "file-header",
              labelKey: "read",
              count: unique.length,
              targets: shown,
              omitted: remaining > 0 ? remaining : undefined,
            },
            toolCallId: callId,
          });
        }
        const baseBudget = deps.outputBudget.read;
        const count = entries.length;
        const budget = {
          maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
          maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
        };
        const result = compactToolOutput(await readSnippets(input.workspace, entries), budget);
        return { kind: "read-file", paths: entries, output: result };
      });
    },
  });
}

function createEditFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  const emitDiffSummaryHeader = createDiffSummaryEmitter({
    toolName: "edit-file",
    labelKey: "edit",
    onOutput: input.onOutput,
  });
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
    labelKey: "edit",
    category: "write",
    permissions: ["read", "write"],
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `read-file` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `create-file`. For code renames or structural edits use `edit-code`.",
    instruction: [
      "Use `edit-file` for text edits.",
      "For small visible changes, prefer {find, replace} where `find` is the exact changed line or the smallest unique snippet from the latest direct `read-file` of that file.",
      "Keep anchors tight, keep line-range edits to the changed lines when possible, and preserve nearby path or link style.",
      "When changing multiple places in one file, use several small exact edits in one call rather than one oversized `find` block that spans distant locations.",
      "The `edit-file` result already includes a diff preview.",
      "If that preview shows the requested bounded change, stop instead of re-reading, searching, reviewing, or editing that same file again in work mode.",
      "For bounded 'each'/'every'/'all' replacements in one named file, use the latest file text to collect all visible requested occurrences into the same `edit-file` call whenever possible.",
      "If the same requested literal appears in multiple visible locations, include every visible location in that one call rather than editing only the first contiguous block.",
      "Completion means no requested matches remain in that file, not just that one edit succeeded.",
      "For larger block changes use {startLine, endLine, replace} with 1-based line numbers from the latest direct `read-file`; `replace` is only the new text for that region.",
      "Batch multiple edits to the same file into one call.",
      "If the change is a repeated plain-text rewrite in one known file, keep using one consolidated `edit-file` call.",
      "Switch to `edit-code` only for real AST-aware refactors or structural code rewrites.",
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
      return runTool(input.session, "edit-file", toolCallId, toolInput, async (callId) => {
        const rawResult = await editFile({
          workspace: input.workspace,
          path: toolInput.path,
          edits: toolInput.edits,
        });
        emitDiffSummaryHeader(toolInput.path, rawResult, callId);
        for (const content of numberedUnifiedDiffLines(rawResult))
          input.onOutput({ toolName: "edit-file", content, toolCallId: callId });
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.edit);
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

function createCreateFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  const emitDiffSummaryHeader = createDiffSummaryEmitter({
    toolName: "create-file",
    labelKey: "create",
    onOutput: input.onOutput,
  });
  return createTool({
    id: "create-file",
    labelKey: "create",
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "create-file", toolCallId, toolInput, async (callId) => {
        const rawResult = await writeTextFile({
          workspace: input.workspace,
          path: toolInput.path,
          content: toolInput.content,
          overwrite: true,
        });
        emitDiffSummaryHeader(toolInput.path, rawResult, callId);
        for (const content of numberedUnifiedDiffLines(rawResult))
          input.onOutput({ toolName: "create-file", content, toolCallId: callId });
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.create);
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

function createDeleteFileTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "delete-file",
    labelKey: "delete",
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "delete-file", toolCallId, toolInput, async (callId) => {
        const paths = normalizeUniquePaths(toolInput.paths);
        const deleteDetail = paths.length > 0 ? formatDeletePaths(paths) : undefined;
        input.onOutput({
          toolName: "delete-file",
          content: { kind: "tool-header", labelKey: "delete", detail: deleteDetail },
          toolCallId: callId,
        });
        const resultParts: string[] = [];
        for (const path of paths) {
          const rawResult = await deleteTextFile({ workspace: input.workspace, path });
          resultParts.push(rawResult);
        }
        const rawResult = resultParts.join("\n\n");
        const result = compactToolOutput(rawResult, deps.outputBudget.edit);
        return { kind: "delete-file", paths, deleted: paths.length, output: result };
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
