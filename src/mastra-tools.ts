import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  deleteTextFile,
  editCode,
  editFileReplace,
  fetchWeb,
  findFiles,
  gitDiff,
  gitStatusShort,
  readSnippet,
  runShellCommand,
  searchFiles,
  searchWeb,
  writeTextFile,
} from "./agent-tools";

import { appConfig } from "./app-config";
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
    instruction: "Use `read-file` to inspect code before editing.",
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
  "edit-code": {
    instruction: "For code changes (renames, refactors, structural edits), use `edit-code` with an AST pattern.",
    aliases: ["editCode", "edit_code"],
  },
  "edit-file": {
    instruction: "For prose, config, or non-code changes, use `edit-file` with a short unique `find` snippet.",
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
    instruction: "Use `run-command` to run verification after edits and to execute shell commands.",
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
    return [...filtered.slice(0, maxLines), "…"];
  }
  return filtered;
}

function streamCallId(toolName: string): string {
  return `${toolName}_${crypto.randomUUID().slice(0, 8)}`;
}

function createRunCommandTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "run-command",
    description:
      "Run a shell command in the repository and capture stdout/stderr. Prefer dedicated tools (`find-files`, `search-files`, `read-file`, `edit-file`, `edit-code`) over shell equivalents.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    execute: async (input) => {
      return withToolError("run-command", async () => {
        const toolCallId = streamCallId("run-command");
        const maxStreamLines = 5;
        let streamedLines = 0;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        const emitLine = (message: string): void => {
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
        const rawResult = await runShellCommand(input.command, input.timeoutMs ?? 60_000, ({ stream, text }) => {
          if (stream === "stdout") {
            stdoutBuffer += text;
          } else {
            stderrBuffer += text;
          }
          flushBufferLines(stream);
        });
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
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
        return { result };
      });
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

function createFindFilesTool(_onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "find-files",
    description:
      "Find files in the repository by name or path pattern. To search file contents use `search-files` instead.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("find-files", async () => {
        const maxResults = input.maxResults ?? 40;
        const result = compactToolOutput(
          await findFiles(input.pattern, maxResults),
          appConfig.agent.toolOutputBudget.findFiles,
        );
        return { result };
      });
    },
  });
}

function createSearchFilesTool(_onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "search-files",
    description:
      "Search file contents in the repository for a text or regex pattern. To locate files by name use `find-files` instead.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (input) => {
      return withToolError("search-files", async () => {
        const maxResults = input.maxResults ?? 20;
        const result = compactToolOutput(
          await searchFiles(input.pattern, maxResults),
          appConfig.agent.toolOutputBudget.searchFiles,
        );
        return { result };
      });
    },
  });
}

function createReadFileTool(_onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "read-file",
    description:
      "Read a text file snippet by line range from the local repository. Use to inspect code before editing.",
    inputSchema: z
      .object({
        path: z.string().min(1),
        start: z.number().int().min(1).optional(),
        end: z.number().int().min(1).optional(),
      })
      .refine((input) => input.start === undefined || input.end === undefined || input.start <= input.end, {
        message: "start must be less than or equal to end",
        path: ["end"],
      }),
    execute: async (input) => {
      return withToolError("read-file", async () => {
        const start = input.start != null ? String(input.start) : undefined;
        const end = input.end != null ? String(input.end) : undefined;
        const result = compactToolOutput(
          await readSnippet(input.path, start, end),
          appConfig.agent.toolOutputBudget.read,
        );
        return { result };
      });
    },
  });
}

export const readFileTool = createReadFileTool();

function createGitStatusTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    inputSchema: z.object({}),
    execute: async () => {
      return withToolError("git-status", async () => {
        const toolCallId = streamCallId("git-status");
        const result = compactToolOutput(await gitStatusShort(), appConfig.agent.toolOutputBudget.gitStatus);
        emitResultChunks("git-status", result, onToolOutput, 80, toolCallId);
        return { result };
      });
    },
  });
}

export const gitStatusTool = createGitStatusTool();

function createGitDiffTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "git-diff",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (input) => {
      return withToolError("git-diff", async () => {
        const toolCallId = streamCallId("git-diff");
        const result = compactToolOutput(
          await gitDiff(input.path, input.contextLines ?? 3),
          appConfig.agent.toolOutputBudget.gitDiff,
        );
        emitResultChunks("git-diff", result, onToolOutput, 80, toolCallId);
        return { result };
      });
    },
  });
}

export const gitDiffTool = createGitDiffTool();

export const runCommandTool = createRunCommandTool();

function createEditFileTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-file",
    description:
      "Edit an existing file by replacing exact text. Best for prose, config, or non-code edits. For code renames, refactors, or structural edits use `edit-code` instead. `find` must be a short, unique substring (a few lines, not the whole file). You MUST read the file first. For new files, use `create-file`.",
    inputSchema: z.object({
      path: z.string().min(1),
      find: z.string().min(1),
      replace: z.string(),
      dryRun: z.boolean().optional(),
    }),
    execute: async (input) => {
      return withToolError("edit-file", async () => {
        const toolCallId = streamCallId("edit-file");
        const rawResult = await editFileReplace({
          path: input.path,
          find: input.find,
          replace: input.replace,
          dryRun: input.dryRun ?? false,
        });
        for (const line of numberedUnifiedDiffLines(rawResult)) {
          onToolOutput?.({ toolName: "edit-file", message: line, toolCallId });
        }
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
        return { result };
      });
    },
  });
}

function createCreateFileTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "create-file",
    description:
      "Create a new file with full content. For editing existing files, use `edit-file` or `edit-code` instead.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    execute: async (input) => {
      return withToolError("create-file", async () => {
        const toolCallId = streamCallId("create-file");
        const rawResult = await writeTextFile({
          path: input.path,
          content: input.content,
          overwrite: true,
        });
        const contentLines = input.content.split("\n");
        const maxStreamLines = 30;
        const count = Math.min(contentLines.length, maxStreamLines);
        for (let i = 0; i < count; i++) {
          onToolOutput?.({ toolName: "create-file", message: `${i + 1}  ${contentLines[i]}`, toolCallId });
        }
        if (contentLines.length > maxStreamLines) {
          onToolOutput?.({ toolName: "create-file", message: "…", toolCallId });
        }
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.create);
        return { result };
      });
    },
  });
}

function createAstEditTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "edit-code",
    description:
      "The default tool for editing code files. Uses AST pattern matching with `$VARIABLE` metavariables. Use for renames, refactors, signature changes, call-site updates, and any structural code edit. Supports TS/TSX/JS/JSX/HTML/CSS/Python/Rust/Go. Example: pattern=`console.log($ARG)` replacement=`logger.debug($ARG)`. For prose, config, or non-code files use `edit-file` instead.",
    inputSchema: z.object({
      path: z.string().min(1),
      pattern: z.string().min(1),
      replacement: z.string(),
      dryRun: z.boolean().optional(),
    }),
    execute: async (input) => {
      return withToolError("edit-code", async () => {
        const toolCallId = streamCallId("edit-code");
        const rawResult = await editCode({
          path: input.path,
          pattern: input.pattern,
          replacement: input.replacement,
          dryRun: input.dryRun ?? false,
        });
        for (const line of numberedUnifiedDiffLines(rawResult)) {
          onToolOutput?.({ toolName: "edit-code", message: line, toolCallId });
        }
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.astEdit);
        return { result };
      });
    },
  });
}

function createDeleteFileTool(_onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "delete-file",
    description: "Delete a file from the repository. Supports dry run mode.",
    inputSchema: z.object({
      path: z.string().min(1),
      dryRun: z.boolean().optional(),
    }),
    execute: async (input) => {
      return withToolError("delete-file", async () => {
        const rawResult = await deleteTextFile({
          path: input.path,
          dryRun: input.dryRun ?? false,
        });
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.edit);
        return { result };
      });
    },
  });
}

export const editFileTool = createEditFileTool();
export const createFileTool = createCreateFileTool();
export const editCodeTool = createAstEditTool();
export const deleteFileTool = createDeleteFileTool();

function createWebSearchTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-search",
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-search", async () => {
        const toolCallId = streamCallId("web-search");
        const result = compactToolOutput(
          await searchWeb(input.query, input.maxResults ?? 5),
          appConfig.agent.toolOutputBudget.webSearch,
        );
        emitResultChunks("web-search", result, onToolOutput, 80, toolCallId);
        return { result };
      });
    },
  });
}

export const webSearchTool = createWebSearchTool();

function createWebFetchTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-fetch",
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    execute: async (input) => {
      return withToolError("web-fetch", async () => {
        const toolCallId = streamCallId("web-fetch");
        const result = compactToolOutput(
          await fetchWeb(input.url, input.maxChars ?? 5000),
          appConfig.agent.toolOutputBudget.webFetch,
        );
        emitResultChunks("web-fetch", result, onToolOutput, 80, toolCallId);
        return { result };
      });
    },
  });
}

export const webFetchTool = createWebFetchTool();

export const acolyteTools = {
  findFiles: createFindFilesTool(),
  searchFiles: createSearchFilesTool(),
  readFile: readFileTool,
  gitStatus: gitStatusTool,
  gitDiff: gitDiffTool,
  runCommand: runCommandTool,
  editCode: editCodeTool,
  editFile: editFileTool,
  createFile: createFileTool,
  deleteFile: deleteFileTool,
  webSearch: webSearchTool,
  webFetch: webFetchTool,
};

export type AcolyteToolset = typeof acolyteTools;

function readOnlyTools(): Partial<AcolyteToolset> {
  return {
    findFiles: acolyteTools.findFiles,
    searchFiles: acolyteTools.searchFiles,
    readFile: acolyteTools.readFile,
    gitStatus: acolyteTools.gitStatus,
    gitDiff: acolyteTools.gitDiff,
    webSearch: acolyteTools.webSearch,
    webFetch: acolyteTools.webFetch,
  };
}

export function toolsForAgent(options?: { onToolOutput?: ToolOutputListener }): Partial<AcolyteToolset> {
  if (appConfig.agent.permissions.mode === "read") {
    return readOnlyTools();
  }
  if (!options?.onToolOutput) {
    return acolyteTools;
  }
  return {
    ...acolyteTools,
    findFiles: createFindFilesTool(options.onToolOutput),
    searchFiles: createSearchFilesTool(options.onToolOutput),
    readFile: createReadFileTool(options.onToolOutput),
    gitStatus: createGitStatusTool(options.onToolOutput),
    gitDiff: createGitDiffTool(options.onToolOutput),
    runCommand: createRunCommandTool(options.onToolOutput),
    editCode: createAstEditTool(options.onToolOutput),
    editFile: createEditFileTool(options.onToolOutput),
    createFile: createCreateFileTool(options.onToolOutput),
    deleteFile: createDeleteFileTool(options.onToolOutput),
    webSearch: createWebSearchTool(options.onToolOutput),
    webFetch: createWebFetchTool(options.onToolOutput),
  };
}
