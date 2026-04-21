import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { deleteTextFile, editFile, findFiles, readFileContent, searchFiles, writeTextFile } from "./file-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { diffSummaryParts, emitParts, findSummaryParts, searchSummaryParts } from "./tool-output-format";
import {
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryStats,
  summarizeUnifiedDiff,
} from "./tool-output-parse";

function toDisplayPath(path: string, workspace?: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("./")) return trimmed.slice(2);
  if (!workspace || !isAbsolute(trimmed)) return trimmed;
  const rel = relative(workspace, trimmed).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return trimmed;
  return rel || trimmed;
}

function createFindFilesTool(input: ToolkitInput) {
  return createTool({
    id: "file-find",
    toolkit: "file",
    category: "search",
    description:
      "Find files by name or path pattern. Use parallel tool calls for multiple patterns. To search file contents use `file-search` instead.",
    instruction: "Use `file-find` to locate files by name/path pattern.",
    inputSchema: z.object({
      pattern: z.string().min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-find"),
      pattern: z.string().min(1),
      matches: z.number().int().nonnegative(),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-find", toolCallId, toolInput, async (callId) => {
        const patterns = [toolInput.pattern];
        const raw = await findFiles(input.workspace, patterns);
        const paths = findResultPaths(raw);
        emitParts(findSummaryParts(paths, patterns, "tool.label.file_find"), "file-find", input.onOutput, callId);
        return {
          kind: "file-find" as const,
          pattern: toolInput.pattern,
          matches: paths.length,
          paths,
          output: raw,
        };
      });
    },
  });
}

function createSearchFilesTool(input: ToolkitInput) {
  return createTool({
    id: "file-search",
    toolkit: "file",
    category: "search",
    description:
      "Search file contents for a text or regex pattern. Optionally scope with `path` (file or directory). Use parallel tool calls for multiple patterns. To locate files by name use `file-find` instead.",
    instruction:
      "Use `file-search` for text/regex content search. Narrow scope with `path`. If needed text is already visible in `file-read`, edit from that evidence instead of re-searching.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      path: z.string().min(1).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("file-search"),
      pattern: z.string().min(1),
      matches: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-search", toolCallId, toolInput, async (callId) => {
        const patterns = [toolInput.pattern];
        const paths = toolInput.path ? [toolInput.path] : undefined;
        const result = await searchFiles(input.workspace, patterns, toolInput.maxResults ?? 20, paths);
        const summaryStats = searchResultSummaryStats(result, patterns);
        emitParts(
          searchSummaryParts(summaryStats, patterns, paths, "tool.label.file_search", input.workspace),
          "file-search",
          input.onOutput,
          callId,
        );
        return {
          kind: "file-search" as const,
          pattern: toolInput.pattern,
          matches: summaryStats.files,
          output: result,
        };
      });
    },
  });
}

const FILE_READ_MAX_LINES = 10_000;

function createReadFileTool(input: ToolkitInput) {
  return createTool({
    id: "file-read",
    toolkit: "file",
    category: "read",
    description:
      "Read a single text file. Use parallel tool calls to read multiple files. Never re-read a file you already have.",
    instruction:
      "Use `file-read` before `file-edit` or `code-edit`. For named edits, re-read the target file immediately before editing.",
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-read"),
      path: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-read", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "file-read",
          content: {
            kind: "file-header",
            labelKey: "tool.label.file_read",
            count: 1,
            targets: [toDisplayPath(toolInput.path, input.workspace)],
          },
          toolCallId: callId,
        });
        const output = await readFileContent(input.workspace, toolInput.path, FILE_READ_MAX_LINES);
        return { kind: "file-read" as const, path: toolInput.path, output };
      });
    },
  });
}

function createEditFileTool(input: ToolkitInput) {
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
            z.object({
              startLine: z.number().int().min(1, "Line numbers must be >= 1"),
              endLine: z.number().int().min(1, "Line numbers must be >= 1"),
              replace: z.string(),
            }),
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
        return {
          kind: "file-edit" as const,
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          output: rawResult,
        };
      });
    },
  });
}

function createCreateFileTool(input: ToolkitInput) {
  return createTool({
    id: "file-create",
    toolkit: "file",
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
        return {
          kind: "file-create" as const,
          path: toolInput.path,
          files: totals.files > 0 ? totals.files : 1,
          added: totals.added,
          removed: totals.removed,
          output: rawResult,
        };
      });
    },
  });
}

function createDeleteFileTool(input: ToolkitInput) {
  return createTool({
    id: "file-delete",
    toolkit: "file",
    category: "write",
    description: "Delete a single file from the repository. Use parallel tool calls to delete multiple files.",
    instruction: "Use `file-delete` to remove a file.",
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-delete"),
      path: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-delete", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "file-delete",
          content: {
            kind: "tool-header",
            labelKey: "tool.label.file_delete",
            detail: toDisplayPath(toolInput.path, input.workspace),
          },
          toolCallId: callId,
        });
        const output = await deleteTextFile({ workspace: input.workspace, path: toolInput.path });
        return { kind: "file-delete" as const, path: toolInput.path, output };
      });
    },
  });
}

export function createFileToolkit(input: ToolkitInput) {
  return {
    findFiles: createFindFilesTool(input),
    searchFiles: createSearchFilesTool(input),
    readFile: createReadFileTool(input),
    editFile: createEditFileTool(input),
    createFile: createCreateFileTool(input),
    deleteFile: createDeleteFileTool(input),
  };
}
