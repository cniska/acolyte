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
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `file-search` instead.",
    instruction:
      "Use `file-find` to locate files by name/path pattern. Pass `patterns` as an array and batch related lookups.",
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
        const baseBudget = deps.outputBudget.fileFind;
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
    description:
      "Search file contents in the repository for text or regex patterns. Optionally scope with `paths` (files or directories). To locate files by name use `file-find` instead.",
    instruction: [
      "Use `file-search` for text/regex content search.",
      "Narrow scope with `paths` and batch related queries in `patterns`.",
      "If needed text is already visible in `file-read`, edit from that evidence instead of re-searching.",
      "Build `file-edit` calls from current `file-read` text or scoped `file-search` hits.",
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
          deps.outputBudget.fileSearch,
        );
        const summaryStats = searchResultSummaryStats(result, patterns);
        const summaryParts = searchSummaryParts(
          summaryStats,
          patterns,
          toolInput.paths,
          "tool.label.file_search",
          input.workspace,
        );
        emitParts(summaryParts, "file-search", input.onOutput, callId);
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
    description:
      "Read one or more text files. Pass `paths` as an array of {path} objects. Never re-read a file you already have.",
    instruction:
      "Use `file-read` before `file-edit` or `code-edit`. Batch discovery reads; for named edits, re-read the target file immediately before editing.",
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
        const raw = await readFileContents(input.workspace, paths, deps.outputBudget.fileRead.maxLines);
        const output = compactToolOutput(raw, deps.outputBudget.fileRead);
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
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `file-read` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `file-create`. For code renames or structural edits use `code-edit`.",
    instruction: [
      "Use `file-edit` for bounded text edits.",
      "Use exact {find, replace} snippets from the latest direct `file-read` of that file.",
      "Keep edits tight and batch same-file edits in one call.",
      "For larger blocks use {startLine, endLine, replace} with 1-based lines from the latest `file-read`.",
      "Use the diff preview to confirm bounded changes and stop.",
      "Use `code-edit` for structural AST-aware refactors.",
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
        const summaryParts = diffSummaryParts(toolInput.path, rawResult, "tool.label.file_edit");
        const diffParts = numberedUnifiedDiffLines(rawResult);
        emitParts(summaryParts, "file-edit", input.onOutput, callId);
        emitParts(diffParts, "file-edit", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.fileEdit);
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
        const summaryParts = diffSummaryParts(toolInput.path, rawResult, "tool.label.file_create");
        const diffParts = numberedUnifiedDiffLines(rawResult);
        emitParts(summaryParts, "file-create", input.onOutput, callId);
        emitParts(diffParts, "file-create", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(rawResult);
        const result = compactToolOutput(rawResult, deps.outputBudget.fileCreate);
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
    description: "Delete a file from the repository.",
    instruction: "Use `file-delete` to remove files. Pass `paths` as an array and batch related deletes.",
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
        const result = compactToolOutput(rawResult, deps.outputBudget.fileEdit);
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
