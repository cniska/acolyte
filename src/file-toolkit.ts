import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { deleteTextFile, editFile, findFiles, readFileContent, searchFiles, writeTextFile } from "./file-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { contentParts, diffSummaryParts, emitParts, findSummaryParts, searchSummaryParts } from "./tool-output-format";
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
      "Find files by name or path pattern. The pattern is a glob (`*`, `?`, `**`, `[abc]`, `{a,b}`) matched against workspace-relative paths, or a case-insensitive substring when it has no wildcard. A leading `/` anchors at the workspace root. Results are capped: the result cap reports the full match count, while a workspace scan cap reports a lower bound. To search file contents use `file-search` instead.",
    inputSchema: z.object({
      pattern: z.string().min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("file-find"),
      pattern: z.string().min(1),
      matches: z.number().int().nonnegative(),
      truncated: z.boolean(),
      paths: z.array(z.string().min(1)),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "file-find", toolCallId, toolInput, async (callId) => {
        const patterns = [toolInput.pattern];
        const { output, totalMatches, truncated } = await findFiles(input.workspace, patterns);
        const paths = findResultPaths(output);
        emitParts(findSummaryParts(paths, patterns, "tool.label.file_find"), "file-find", input.onOutput, callId);
        return {
          kind: "file-find" as const,
          pattern: toolInput.pattern,
          matches: totalMatches,
          truncated: truncated || paths.length < totalMatches,
          paths,
          output,
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
      "Search file contents for a text or regex pattern. Optionally scope with `path` (file or directory). To locate files by name use `file-find` instead.",
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

function createReadFileTool(input: ToolkitInput) {
  return createTool({
    id: "file-read",
    toolkit: "file",
    category: "read",
    description:
      "Read a text file. I return the whole file as numbered lines under a `Lines: start-end of total` header. A file over the token ceiling fails with its line count; re-read it with `offset` (the 1-based first line) and `limit` (how many lines) to select the part you need. A file over the byte ceiling is not readable at any range — search it with `file-search`.",
    inputSchema: z.object({
      path: z.string().min(1),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based line to start from. Only for a file too large to read whole."),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Number of lines to return. Only for a file too large to read whole."),
    }),
    outputSchema: z.object({
      kind: z.literal("file-read"),
      path: z.string().min(1),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional(),
      totalLines: z.number().int().nonnegative(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const readInput = { path: toolInput.path, offset: toolInput.offset, limit: toolInput.limit };
      return runTool(input.session, "file-read", toolCallId, readInput, async (callId) => {
        input.onOutput({
          toolName: "file-read",
          content: {
            kind: "file-header",
            labelKey: "tool.label.file_read",
            count: 1,
            targets: [toDisplayPath(readInput.path, input.workspace)],
          },
          toolCallId: callId,
        });
        const read = await readFileContent(input.workspace, toolInput.path, {
          offset: toolInput.offset,
          limit: toolInput.limit,
        });
        input.onOutput({
          toolName: "file-read",
          content: {
            kind: "file-header",
            labelKey: "tool.label.file_read",
            count: 1,
            targets: [toDisplayPath(readInput.path, input.workspace)],
            summary: `${read.startLine}-${read.endLine}`,
          },
          toolCallId: callId,
        });
        return {
          kind: "file-read" as const,
          path: toolInput.path,
          offset: toolInput.offset,
          limit: toolInput.limit,
          totalLines: read.totalLines,
          output: read.output,
        };
      });
    },
  });
}

function createEditFileTool(input: ToolkitInput) {
  const outputSchema = z.object({
    kind: z.literal("file-edit"),
    path: z.string().min(1),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    output: z.string(),
  });
  return createTool({
    id: "file-edit",
    toolkit: "file",
    category: "write",
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs, which match exact text, or {startLine, endLine, replace} objects, which address lines as `file-read` numbers them. Every edit in one call is located against that same content, so edits in a batch do not shift each other. An endLine past the last line is clamped to it. All edits in a call are applied together or none are.",
    inputSchema: z.object({
      path: z.string().min(1),
      edits: z
        .array(
          z.union([
            z.object({
              find: z.string().min(1),
              replace: z.string(),
            }),
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
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    outputSchema: z.object({
      kind: z.literal("file-create"),
      path: z.string().min(1),
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
        });
        const summaryParts = diffSummaryParts(toolInput.path, rawResult, "tool.label.file_create");
        emitParts(summaryParts, "file-create", input.onOutput, callId);
        emitParts(contentParts(toolInput.content), "file-create", input.onOutput, callId);
        const totals = summarizeUnifiedDiff(rawResult);
        return {
          kind: "file-create" as const,
          path: toolInput.path,
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
    description: "Delete a file from the file system.",
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
