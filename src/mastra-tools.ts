import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appConfig } from "./app-config";
import {
  deleteTextFile,
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
} from "./coding-tools";
import { compactToolOutput } from "./tool-output";

type ToolOutputListener = (event: { toolName: string; message: string; toolCallId?: string }) => void;

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
      rendered.push(`${newLine}   ${line.slice(1)}`);
      oldLine += 1;
      newLine += 1;
      continue;
    }
    rendered.push(line);
  }
  if (rendered.length > maxLines) {
    const omitted = rendered.length - maxLines;
    return [...rendered.slice(0, maxLines), `… ${omitted} lines truncated`];
  }
  return rendered;
}

function streamCallId(toolName: string): string {
  return `${toolName}_${crypto.randomUUID().slice(0, 8)}`;
}

function createRunCommandTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "run-command",
    description: "Run a shell command in the repository and capture stdout/stderr.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    execute: async (input) => {
      return withToolError("run-command", async () => {
        const toolCallId = streamCallId("run-command");
        let stdoutBuffer = "";
        let stderrBuffer = "";
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
              onToolOutput?.({ toolName: "run-command", message: `${label} | ${line}`, toolCallId });
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
            onToolOutput?.({ toolName: "run-command", message: `${label} | ${remainder}`, toolCallId });
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
    description: "Find files in the repository by name or path pattern.",
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
    description: "Search file contents in the repository for a text or regex pattern.",
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
    description: "Read a text file snippet by line range from the local repository.",
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
    description: "Get git status --short --branch for the current repository.",
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
    description: "Get git diff for the repository or a specific file path.",
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
    description: "Create/update file content or replace exact text in an existing file.",
    inputSchema: z
      .object({
        path: z.string().min(1),
        find: z.string().optional(),
        replace: z.string().optional(),
        content: z.string().optional(),
        overwrite: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      })
      .refine(
        (input) => typeof input.content === "string" || (typeof input.find === "string" && input.find.length > 0),
        {
          message: "Provide either content, or find+replace.",
          path: ["content"],
        },
      ),
    execute: async (input: {
      path: string;
      find?: string;
      replace?: string;
      content?: string;
      overwrite?: boolean;
      dryRun?: boolean;
    }) => {
      return withToolError("edit-file", async () => {
        const toolCallId = streamCallId("edit-file");
        const rawResult =
          typeof input.content === "string"
            ? await writeTextFile({
                path: input.path,
                content: input.content,
                overwrite: input.overwrite ?? true,
              })
            : await editFileReplace({
                path: input.path,
                find: input.find ?? "",
                replace: input.replace ?? "",
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

function createDeleteFileTool(_onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "delete-file",
    description: "Delete a file. Supports dry run mode.",
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
export const deleteFileTool = createDeleteFileTool();

function createWebSearchTool(onToolOutput?: ToolOutputListener) {
  return createTool({
    id: "web-search",
    description: "Search the public web for recent information and return top results.",
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
    description: "Fetch a public URL and return extracted text content.",
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
  editFile: editFileTool,
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
    editFile: createEditFileTool(options.onToolOutput),
    deleteFile: createDeleteFileTool(options.onToolOutput),
    webSearch: createWebSearchTool(options.onToolOutput),
    webFetch: createWebFetchTool(options.onToolOutput),
  };
}
