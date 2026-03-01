import { resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appConfig } from "./app-config";
import { createId } from "./short-id";
import { LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { createSessionContext, recordCall, runGuards, type SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";
import { compactToolOutput } from "./tool-output";
import {
  emitFileListSummary,
  emitResultChunks,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultPaths,
} from "./tool-output-format";
import {
  deleteTextFile,
  editCode,
  editFile,
  fetchWeb,
  findFiles,
  gitDiff,
  gitStatusShort,
  readSnippets,
  runShellCommand,
  scanCode,
  searchFiles,
  searchWeb,
  writeTextFile,
} from "./tools";

// --- Tool metadata ---

type ToolOutputListener = (event: { toolName: ToolName; message: string; toolCallId?: string }) => void;
const WRITE_TOOL_PREVIEW_MAX_LINES = 30;

export type ToolMeta = {
  instruction: string;
  aliases: string[];
};

export const toolMeta: Record<ToolName, ToolMeta> = {
  "find-files": {
    instruction:
      "Use `find-files` to locate files by name or path pattern. Always pass `patterns` as an array (e.g. [`api.ts`, `store.ts`]).",
    aliases: ["findFiles", "find_files"],
  },
  "search-files": {
    instruction: "Use `search-files` to search file contents by text or regex.",
    aliases: ["searchFiles", "search_files", "searchRepo", "search_repo"],
  },
  "read-file": {
    instruction:
      "Use `read-file` to inspect code before editing. Pass `paths` as an array; batch multiple reads into one call.",
    aliases: ["readFile", "read_file"],
  },
  "git-status": {
    instruction: "Use `git-status` for working tree status.",
    aliases: ["gitStatus", "git_status"],
  },
  "git-diff": {
    instruction: "Use `git-diff` for change inspection.",
    aliases: ["gitDiff", "git_diff"],
  },
  "web-search": {
    instruction: "Use `web-search` for external information lookup.",
    aliases: ["webSearch", "web_search"],
  },
  "web-fetch": {
    instruction: "Use `web-fetch` to read web pages, docs, or API references.",
    aliases: ["webFetch", "web_fetch"],
  },
  "scan-code": {
    instruction:
      "Use `scan-code` for AST pattern matching. Always pass `paths` and `patterns` as arrays. Batch multiple files and patterns in one call (e.g. paths=[`src/a.ts`, `src/b.ts`], patterns=[`export function $NAME`, `import $SPEC from $MOD`]). Metavariable names (`$NAME`, `$ARG`) are wildcards — they match any node, not literal text. Use it to map rename/refactor targets before `edit-code`. For keyword or regex searches prefer `search-files`.",
    aliases: ["scanCode", "scan_code"],
  },
  "edit-code": {
    instruction:
      "Use `edit-code` for multi-location code changes, rename/refactor updates, or structural rewrites with AST `edits` array. `path` must be a concrete file path (not `.` or a directory). Prefer `edit-file` for single-location text edits.",
    aliases: ["editCode", "edit_code"],
  },
  "edit-file": {
    instruction:
      "Use `edit-file` for text edits. For small changes use {find, replace} pairs where `find` is exact text to locate. For larger block changes use {startLine, endLine, replace} with 1-based line numbers from `read-file`. `replace` is *only* the new text for that region — do not include surrounding lines. Batch multiple edits to the same file into one call. If `find` is likely to match multiple locations, switch to `edit-code`.",
    aliases: ["editFile", "edit_file"],
  },
  "create-file": {
    instruction: "For new files, call `create-file` with full content directly.",
    aliases: ["createFile", "create_file", "writeFile", "write_file"],
  },
  "delete-file": {
    instruction: "Use `delete-file` to remove files from the repository.",
    aliases: ["deleteFile", "delete_file"],
  },
  "run-command": {
    instruction:
      "Use `run-command` to run verification after edits and to execute build/test commands. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `read-file`, `search-files`, `find-files`, `edit-file`, or `edit-code`.",
    aliases: ["runCommand", "run_command", "execute_command"],
  },
};

// --- Output helpers ---

function streamCallId(toolName: ToolName): string {
  return `${toolName}_${createId()}`;
}

// --- Guarded execution ---

function createRunCommandTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "run-command",
    description:
      "Run a shell command in the repository and capture stdout/stderr. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    execute: async (input) => {
      return withToolError("run-command", () =>
        guardedExecute("run-command", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("run-command");
          const maxStreamLines = 5;
          let streamedLines = 0;
          let totalLines = 0;
          let stdoutBuffer = "";
          let stderrBuffer = "";
          const emitLine = (message: string): void => {
            totalLines += 1;
            if (streamedLines >= maxStreamLines) return;
            streamedLines += 1;
            onToolOutput?.({ toolName: "run-command", message, toolCallId });
          };
          const flushBufferLines = (stream: "stdout" | "stderr"): void => {
            const label = stream === "stdout" ? "out" : "err";
            const source = stream === "stdout" ? stdoutBuffer : stderrBuffer;
            let remaining = source;
            while (true) {
              const newlineIndex = remaining.indexOf("\n");
              if (newlineIndex === -1) break;
              const line = remaining.slice(0, newlineIndex).trimEnd();
              remaining = remaining.slice(newlineIndex + 1);
              if (line.length > 0) emitLine(`${label} | ${line}`);
            }
            if (stream === "stdout") {
              stdoutBuffer = remaining;
            } else {
              stderrBuffer = remaining;
            }
          };
          const rawResult = await runShellCommand(
            workspace,
            input.command,
            input.timeoutMs ?? 60_000,
            ({ stream, text }) => {
              if (stream === "stdout") {
                stdoutBuffer += text;
              } else {
                stderrBuffer += text;
              }
              flushBufferLines(stream);
            },
          );
          const flushRemainder = (stream: "stdout" | "stderr"): void => {
            const label = stream === "stdout" ? "out" : "err";
            const remainder = (stream === "stdout" ? stdoutBuffer : stderrBuffer).trimEnd();
            if (remainder.length > 0) emitLine(`${label} | ${remainder}`);
            if (stream === "stdout") {
              stdoutBuffer = "";
            } else {
              stderrBuffer = "";
            }
          };
          flushRemainder("stdout");
          flushRemainder("stderr");
          const omitted = totalLines - streamedLines;
          if (omitted > 0) onToolOutput?.({ toolName: "run-command", message: `… +${omitted} lines`, toolCallId });
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
          return { result };
        }),
      );
    },
  });
}

export async function withToolError<T>(toolId: ToolName, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`${toolId} failed: ${message}`) as Error & { code?: string };
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) wrapped.code = code;
    }
    throw wrapped;
  }
}

async function guardedExecute<T>(
  toolId: ToolName,
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    runGuards({ toolName: toolId, args, session });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Guard blocked");
    const coded = wrapped as Error & { code?: string };
    if (typeof coded.code !== "string" || coded.code.length === 0) coded.code = LIFECYCLE_ERROR_CODES.guardBlocked;
    throw coded;
  }
  try {
    const result = await task();
    return result;
  } finally {
    recordCall(session, toolId, args);
  }
}

// --- Tool factories ---

function createFindFilesTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "find-files",
    description:
      "Find files in the repository by name or path pattern. Pass `patterns` as an array to batch multiple lookups in one call. To search file contents use `search-files` instead.",
    inputSchema: z.object({
      patterns: z.array(z.string().min(1)).min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("find-files", () =>
        guardedExecute("find-files", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("find-files");
          const maxResults = input.maxResults ?? 40;
          const count = input.patterns.length;
          const baseBudget = appConfig.agent.toolOutputBudget.findFiles;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await findFiles(workspace, input.patterns, maxResults), budget);
          emitFileListSummary("find-files", findResultPaths(result), onToolOutput, toolCallId);
          return { result };
        }),
      );
    },
  });
}

function createSearchFilesTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "search-files",
    description:
      "Search file contents in the repository for a text or regex pattern. To locate files by name use `find-files` instead.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("search-files", () =>
        guardedExecute("search-files", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("search-files");
          const maxResults = input.maxResults ?? 20;
          const result = compactToolOutput(
            await searchFiles(workspace, input.pattern, maxResults),
            appConfig.agent.toolOutputBudget.searchFiles,
          );
          emitFileListSummary("search-files", searchResultPaths(result), onToolOutput, toolCallId);
          return { result };
        }),
      );
    },
  });
}

function createScanCodeTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "scan-code",
    description:
      "Scan files for structural code patterns using AST matching. Pass `paths` as an array of file or directory paths and `patterns` as an array of ast-grep patterns with `$VAR` metavariables (e.g. [`export function $NAME($$$PARAMS)`, `import $SPEC from $MOD`]).",
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).min(1),
      patterns: z.array(z.string().min(1)).min(1),
      language: z.string().optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("scan-code", () =>
        guardedExecute("scan-code", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("scan-code");
          emitFileListSummary("scan-code", input.paths, onToolOutput, toolCallId);
          const baseBudget = appConfig.agent.toolOutputBudget.scanCode;
          const count = input.paths.length * input.patterns.length;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(
            await scanCode({
              workspace,
              paths: input.paths,
              pattern: input.patterns,
              language: input.language,
              maxResults: input.maxResults ?? 50,
            }),
            budget,
          );
          return { result };
        }),
      );
    },
  });
}

function createReadFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "read-file",
    description:
      "Read one or more text file snippets by line range. Always pass `paths` as an array of {path, start?, end?} objects, even for a single file. Use to inspect code before editing.",
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
    execute: async (input) => {
      return withToolError("read-file", () =>
        guardedExecute("read-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("read-file");
          emitFileListSummary(
            "read-file",
            input.paths.map((entry) => entry.path),
            onToolOutput,
            toolCallId,
          );
          const entries = input.paths.map((p) => ({
            path: p.path,
            start: p.start != null ? String(p.start) : undefined,
            end: p.end != null ? String(p.end) : undefined,
          }));
          const baseBudget = appConfig.agent.toolOutputBudget.read;
          const count = entries.length;
          const budget = {
            maxChars: Math.max(400, Math.floor(baseBudget.maxChars / count) * count),
            maxLines: Math.max(20, Math.floor(baseBudget.maxLines / count) * count),
          };
          const result = compactToolOutput(await readSnippets(workspace, entries), budget);
          return { result };
        }),
      );
    },
  });
}

function createGitStatusTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    inputSchema: z.object({}),
    execute: async () => {
      return withToolError("git-status", () =>
        guardedExecute("git-status", {}, session, async () => {
          const result = compactToolOutput(await gitStatusShort(workspace), appConfig.agent.toolOutputBudget.gitStatus);
          return { result };
        }),
      );
    },
  });
}

function createGitDiffTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "git-diff",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (input) => {
      return withToolError("git-diff", () =>
        guardedExecute("git-diff", input as Record<string, unknown>, session, async () => {
          const result = compactToolOutput(
            await gitDiff(workspace, input.path, input.contextLines ?? 3),
            appConfig.agent.toolOutputBudget.gitDiff,
          );
          return { result };
        }),
      );
    },
  });
}

function createEditFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-file",
    description:
      "Edit an existing file. Pass `edits` as an array of either {find, replace} pairs (for small surgical edits using exact text match) or {startLine, endLine, replace} objects (for larger block replacements). Line numbers MUST come from `read-file` output — do not guess. endLine must not exceed the file length. All edits are applied atomically. You MUST read the file first. For new files, use `create-file`. For code renames or structural edits use `edit-code`.",
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
    execute: async (input) => {
      return withToolError("edit-file", () =>
        guardedExecute("edit-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("edit-file");
          const rawResult = await editFile({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "edit-file", message: line, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return { result };
        }),
      );
    },
  });
}

function createCreateFileTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "create-file",
    description:
      "Create a new file with full content. For editing existing files, use `edit-file` or `edit-code` instead.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      return withToolError("create-file", () =>
        guardedExecute("create-file", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("create-file");
          const rawResult = await writeTextFile({
            workspace,
            path: input.path,
            content: input.content,
            overwrite: true,
          });
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "create-file", message: line, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.create);
          return { result };
        }),
      );
    },
  });
}

function createAstEditTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-code",
    description:
      "Edit code with AST pattern matching. Pass `edits` as [{pattern, replacement}] using `$VAR` metavariables (e.g. pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`). `path` must be a specific file, not '.' or a directory. For non-code files use `edit-file`.",
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
    execute: async (input) => {
      return withToolError("edit-code", () =>
        guardedExecute("edit-code", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("edit-code");
          const rawResult = await editCode({
            workspace,
            path: input.path,
            edits: input.edits,
          });
          for (const line of numberedUnifiedDiffLines(rawResult, WRITE_TOOL_PREVIEW_MAX_LINES)) {
            onToolOutput?.({ toolName: "edit-code", message: line, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.astEdit);
          return { result };
        }),
      );
    },
  });
}

function createDeleteFileTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "delete-file",
    description: "Delete a file from the repository.",
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    execute: async (input) => {
      return withToolError("delete-file", () =>
        guardedExecute("delete-file", input as Record<string, unknown>, session, async () => {
          const rawResult = await deleteTextFile({
            workspace,
            path: input.path,
          });
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
          return { result };
        }),
      );
    },
  });
}

function createWebSearchTool(session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-search",
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-search", () =>
        guardedExecute("web-search", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("web-search");
          const result = compactToolOutput(
            await searchWeb(input.query, input.maxResults ?? 5),
            appConfig.agent.toolOutputBudget.webSearch,
          );
          emitResultChunks("web-search", result, onToolOutput, 80, toolCallId);
          return { result };
        }),
      );
    },
  });
}

function createWebFetchTool(session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-fetch",
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-fetch", () =>
        guardedExecute("web-fetch", input as Record<string, unknown>, session, async () => {
          const toolCallId = streamCallId("web-fetch");
          const result = compactToolOutput(
            await fetchWeb(input.url, input.maxChars ?? 5000),
            appConfig.agent.toolOutputBudget.webFetch,
          );
          emitResultChunks("web-fetch", result, onToolOutput, 80, toolCallId);
          return { result };
        }),
      );
    },
  });
}

// --- Toolset assembly ---

export type AcolyteToolset = ReturnType<typeof createToolset>["tools"];

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return {
    tools: {
      findFiles: createFindFilesTool(workspace, session, onToolOutput),
      searchFiles: createSearchFilesTool(workspace, session, onToolOutput),
      scanCode: createScanCodeTool(workspace, session, onToolOutput),
      readFile: createReadFileTool(workspace, session, onToolOutput),
      gitStatus: createGitStatusTool(workspace, session),
      gitDiff: createGitDiffTool(workspace, session),
      runCommand: createRunCommandTool(workspace, session, onToolOutput),
      editCode: createAstEditTool(workspace, session, onToolOutput),
      editFile: createEditFileTool(workspace, session, onToolOutput),
      createFile: createCreateFileTool(workspace, session, onToolOutput),
      deleteFile: createDeleteFileTool(workspace, session),
      webSearch: createWebSearchTool(session, onToolOutput),
      webFetch: createWebFetchTool(session, onToolOutput),
    },
    session,
  };
}

function readOnlyTools(
  workspace: string,
  session: SessionContext,
  onToolOutput?: ToolOutputListener,
): { tools: Partial<AcolyteToolset>; session: SessionContext } {
  return {
    tools: {
      findFiles: createFindFilesTool(workspace, session, onToolOutput),
      searchFiles: createSearchFilesTool(workspace, session, onToolOutput),
      scanCode: createScanCodeTool(workspace, session, onToolOutput),
      readFile: createReadFileTool(workspace, session, onToolOutput),
      gitStatus: createGitStatusTool(workspace, session),
      gitDiff: createGitDiffTool(workspace, session),
      webSearch: createWebSearchTool(session, onToolOutput),
      webFetch: createWebFetchTool(session, onToolOutput),
    },
    session,
  };
}

// --- Public API ---

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener; taskId?: string }): {
  tools: Partial<AcolyteToolset>;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  if (appConfig.agent.permissions.mode === "read") return readOnlyTools(workspace, session, options?.onToolOutput);
  return createToolset(workspace, session, options?.onToolOutput);
}
