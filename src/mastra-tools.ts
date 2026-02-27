import { resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
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
} from "./agent-tools";

import { appConfig } from "./app-config";
import { createId } from "./short-id";
import { createSessionContext, recordCall, runGuards, type SessionContext } from "./tool-guards";
import { compactToolOutput } from "./tool-output";

type ToolOutputListener = (event: { toolName: string; message: string; toolCallId?: string }) => void;

export type ToolMeta = {
  instruction: string;
  aliases: string[];
};

export const toolMeta: Record<string, ToolMeta> = {
  "find-files": {
    instruction: "Use `find-files` to locate files by name or path pattern.",
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
      "Use `scan-code` for AST pattern matching (e.g. `console.log($ARG)`). Metavariable names (`$NAME`, `$ARG`) are wildcards — they match any node, not literal text. For keyword or regex searches prefer `search-files`.",
    aliases: ["scanCode", "scan_code"],
  },
  "edit-code": {
    instruction:
      "Use `edit-code` for multi-location code changes or structural rewrites with AST `edits` array. Prefer `edit-file` for single-location text edits.",
    aliases: ["editCode", "edit_code"],
  },
  "edit-file": {
    instruction:
      "Use `edit-file` for text edits. For small changes use {find, replace} pairs where `find` is exact text to locate. For larger block changes use {startLine, endLine, replace} with 1-based line numbers from `read-file`. `replace` is *only* the new text for that region — do not include surrounding lines. Batch multiple edits to the same file into one call.",
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
      "Use `run-command` to run verification after edits and to execute build/test commands. Never use it for `cat`, `head`, `grep`, `sed`, `find`, or `wc` — use `read-file`, `search-files`, `find-files` instead.",
    aliases: ["runCommand", "run_command", "execute_command"],
  },
};

function emitResultChunks(
  toolName: string,
  result: string,
  onToolOutput?: ToolOutputListener,
  maxLines = 80,
  toolCallId?: string,
): void {
  if (!onToolOutput) {
    return;
  }
  const allLines = result
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const lines = allLines.slice(0, maxLines);
  for (const line of lines) {
    onToolOutput({ toolName, message: line, toolCallId });
  }
  if (allLines.length > maxLines) {
    onToolOutput({ toolName, message: `… ${allLines.length - maxLines} lines truncated`, toolCallId });
  }
}

function unifiedDiffLines(rawResult: string, maxLines = 120): string[] {
  const marker = "\ndiff --git ";
  const index = rawResult.indexOf(marker);
  const start = index >= 0 ? index + 1 : rawResult.indexOf("diff --git ");
  if (start < 0) {
    return [];
  }
  const lines = rawResult
    .slice(start)
    .split("\n")
    .map((line) => line.trimEnd());
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }
  return lines;
}

function numberedUnifiedDiffLines(rawResult: string, maxLines = 160): string[] {
  const lines = unifiedDiffLines(rawResult, Math.max(maxLines * 2, 240));
  if (lines.length === 0) {
    return [];
  }
  const rendered: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number.parseInt(match[1] ?? "0", 10);
        newLine = Number.parseInt(match[2] ?? "0", 10);
        inHunk = true;
      }
      continue;
    }
    if (!inHunk || line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    if (line.startsWith("+")) {
      rendered.push(`${newLine} + ${line.slice(1)}`);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rendered.push(`${oldLine} - ${line.slice(1)}`);
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      rendered.push(`${newLine}  ${line.slice(1)}`);
      oldLine += 1;
      newLine += 1;
      continue;
    }
    rendered.push(line);
  }
  const contextRadius = 3;
  const isChange = rendered.map((line) => /^\d+\s+[+-]\s/.test(line));
  const keep = new Uint8Array(rendered.length);
  for (let i = 0; i < rendered.length; i++) {
    if (!isChange[i]) {
      continue;
    }
    for (let j = Math.max(0, i - contextRadius); j <= Math.min(rendered.length - 1, i + contextRadius); j++) {
      keep[j] = 1;
    }
  }
  const filtered: string[] = [];
  let skippedCount = 0;
  for (let i = 0; i < rendered.length; i++) {
    if (keep[i]) {
      if (skippedCount > 0) {
        filtered.push("…");
      }
      skippedCount = 0;
      filtered.push(rendered[i] ?? "");
    } else {
      skippedCount += 1;
    }
  }
  if (filtered.length > maxLines) {
    const omitted = filtered.length - maxLines;
    return [...filtered.slice(0, maxLines), `… +${omitted} lines`];
  }
  return filtered;
}

function streamCallId(toolName: string): string {
  return `${toolName}_${createId()}`;
}

function createRunCommandTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "run-command",
    description:
      "Run a shell command in the repository and capture stdout/stderr. Prefer dedicated tools (`find-files`, `search-files`, `read-file`, `edit-file`, `edit-code`) over shell equivalents.",
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
            if (streamedLines >= maxStreamLines) {
              return;
            }
            streamedLines += 1;
            onToolOutput?.({ toolName: "run-command", message, toolCallId });
          };
          const flushBufferLines = (stream: "stdout" | "stderr"): void => {
            const label = stream === "stdout" ? "out" : "err";
            const source = stream === "stdout" ? stdoutBuffer : stderrBuffer;
            let remaining = source;
            while (true) {
              const newlineIndex = remaining.indexOf("\n");
              if (newlineIndex === -1) {
                break;
              }
              const line = remaining.slice(0, newlineIndex).trimEnd();
              remaining = remaining.slice(newlineIndex + 1);
              if (line.length > 0) {
                emitLine(`${label} | ${line}`);
              }
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
            if (remainder.length > 0) {
              emitLine(`${label} | ${remainder}`);
            }
            if (stream === "stdout") {
              stdoutBuffer = "";
            } else {
              stderrBuffer = "";
            }
          };
          flushRemainder("stdout");
          flushRemainder("stderr");
          const omitted = totalLines - streamedLines;
          if (omitted > 0) {
            onToolOutput?.({ toolName: "run-command", message: `… +${omitted} lines`, toolCallId });
          }
          const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
          return { result };
        }),
      );
    },
  });
}

export async function withToolError<T>(toolId: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${toolId} failed: ${message}`);
  }
}

async function guardedExecute<T>(
  toolId: string,
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
): Promise<T> {
  runGuards({ toolName: toolId, args, session });
  const result = await task();
  recordCall(session, toolId, args);
  return result;
}

function createFindFilesTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "find-files",
    description:
      "Find files in the repository by name or path pattern. To search file contents use `search-files` instead.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("find-files", () =>
        guardedExecute("find-files", input as Record<string, unknown>, session, async () => {
          const maxResults = input.maxResults ?? 40;
          const result = compactToolOutput(
            await findFiles(workspace, input.pattern, maxResults),
            appConfig.agent.toolOutputBudget.findFiles,
          );
          return { result };
        }),
      );
    },
  });
}

function createSearchFilesTool(workspace: string, session: SessionContext) {
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
          const maxResults = input.maxResults ?? 20;
          const result = compactToolOutput(
            await searchFiles(workspace, input.pattern, maxResults),
            appConfig.agent.toolOutputBudget.searchFiles,
          );
          return { result };
        }),
      );
    },
  });
}

function createScanCodeTool(workspace: string, session: SessionContext) {
  return createTool({
    id: "scan-code",
    description:
      "Scan files for structural code patterns using AST matching. Pass an ast-grep `pattern` with `$VAR` metavariables (e.g. `console.log($ARG)`, `async function $NAME($$$PARAMS)`). Path can be a file or directory.",
    inputSchema: z.object({
      path: z.string().min(1),
      pattern: z.string().min(1),
      language: z.string().optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("scan-code", () =>
        guardedExecute("scan-code", input as Record<string, unknown>, session, async () => {
          const result = compactToolOutput(
            await scanCode({
              workspace,
              path: input.path,
              pattern: input.pattern,
              language: input.language,
              maxResults: input.maxResults ?? 50,
            }),
            appConfig.agent.toolOutputBudget.scanCode,
          );
          return { result };
        }),
      );
    },
  });
}

function createReadFileTool(workspace: string, session: SessionContext) {
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

function createGitStatusTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    inputSchema: z.object({}),
    execute: async () => {
      return withToolError("git-status", () =>
        guardedExecute("git-status", {}, session, async () => {
          const toolCallId = streamCallId("git-status");
          const result = compactToolOutput(await gitStatusShort(workspace), appConfig.agent.toolOutputBudget.gitStatus);
          emitResultChunks("git-status", result, onToolOutput, 80, toolCallId);
          return { result };
        }),
      );
    },
  });
}

function createGitDiffTool(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
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
          const toolCallId = streamCallId("git-diff");
          const result = compactToolOutput(
            await gitDiff(workspace, input.path, input.contextLines ?? 3),
            appConfig.agent.toolOutputBudget.gitDiff,
          );
          emitResultChunks("git-diff", result, onToolOutput, 80, toolCallId);
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
          for (const line of numberedUnifiedDiffLines(rawResult, 30)) {
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
          for (const line of numberedUnifiedDiffLines(rawResult, 30)) {
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
      "Edit code with AST pattern matching. Pass `edits` as [{pattern, replacement}] using `$VAR` metavariables (e.g. pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`). For non-code files use `edit-file`.",
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
          for (const line of numberedUnifiedDiffLines(rawResult, 30)) {
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

export type AcolyteToolset = ReturnType<typeof createToolset>["tools"];

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return {
    tools: {
      findFiles: createFindFilesTool(workspace, session),
      searchFiles: createSearchFilesTool(workspace, session),
      scanCode: createScanCodeTool(workspace, session),
      readFile: createReadFileTool(workspace, session),
      gitStatus: createGitStatusTool(workspace, session, onToolOutput),
      gitDiff: createGitDiffTool(workspace, session, onToolOutput),
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
      findFiles: createFindFilesTool(workspace, session),
      searchFiles: createSearchFilesTool(workspace, session),
      scanCode: createScanCodeTool(workspace, session),
      readFile: createReadFileTool(workspace, session),
      gitStatus: createGitStatusTool(workspace, session, onToolOutput),
      gitDiff: createGitDiffTool(workspace, session, onToolOutput),
      webSearch: createWebSearchTool(session, onToolOutput),
      webFetch: createWebFetchTool(session, onToolOutput),
    },
    session,
  };
}

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener }): {
  tools: Partial<AcolyteToolset>;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext();
  if (appConfig.agent.permissions.mode === "read") {
    return readOnlyTools(workspace, session, options?.onToolOutput);
  }
  return createToolset(workspace, session, options?.onToolOutput);
}
