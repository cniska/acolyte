import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { editFileReplace, gitDiff, gitStatusShort, readSnippet, runShellCommand, searchRepo } from "./coding-tools";
import { appConfig } from "./app-config";
import { compactToolOutput } from "./tool-output";

export const searchRepoTool = createTool({
  id: "search-repo",
  description: "Search the repository for a text pattern using ripgrep.",
  inputSchema: z.object({
    pattern: z.string().min(1),
    maxResults: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (input) => {
    const maxResults = input.maxResults ?? 40;
    const result = compactToolOutput(
      await searchRepo(input.pattern, maxResults),
      appConfig.agent.toolOutputBudget.search,
    );
    return { result };
  },
});

export const readFileTool = createTool({
  id: "read-file",
  description: "Read a text file snippet by line range from the local repository.",
  inputSchema: z.object({
    path: z.string().min(1),
    start: z.number().int().min(1).optional(),
    end: z.number().int().min(1).optional(),
  }),
  execute: async (input) => {
    const start = input.start ? String(input.start) : undefined;
    const end = input.end ? String(input.end) : undefined;
    const result = compactToolOutput(await readSnippet(input.path, start, end), appConfig.agent.toolOutputBudget.read);
    return { result };
  },
});

export const gitStatusTool = createTool({
  id: "git-status",
  description: "Get git status --short --branch for the current repository.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = compactToolOutput(await gitStatusShort(), appConfig.agent.toolOutputBudget.gitStatus);
    return { result };
  },
});

export const gitDiffTool = createTool({
  id: "git-diff",
  description: "Get git diff for the repository or a specific file path.",
  inputSchema: z.object({
    path: z.string().optional(),
    contextLines: z.number().int().min(0).max(20).optional(),
  }),
  execute: async (input) => {
    const result = compactToolOutput(
      await gitDiff(input.path, input.contextLines ?? 3),
      appConfig.agent.toolOutputBudget.gitDiff,
    );
    return { result };
  },
});

export const runCommandTool = createTool({
  id: "run-command",
  description: "Run a shell command in the repository and capture stdout/stderr.",
  inputSchema: z.object({
    command: z.string().min(1),
    timeoutMs: z.number().int().min(500).max(120000).optional(),
  }),
  execute: async (input) => {
    const result = compactToolOutput(
      await runShellCommand(input.command, input.timeoutMs ?? 60_000),
      appConfig.agent.toolOutputBudget.run,
    );
    return { result };
  },
});

export const editFileTool = createTool({
  id: "edit-file",
  description: "Replace exact text in a file. Supports dry run mode.",
  inputSchema: z.object({
    path: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
    dryRun: z.boolean().optional(),
  }),
  execute: async (input) => {
    const result = compactToolOutput(
      await editFileReplace({
        path: input.path,
        find: input.find,
        replace: input.replace,
        dryRun: input.dryRun ?? false,
      }),
      appConfig.agent.toolOutputBudget.edit,
    );
    return { result };
  },
});

export const acolyteTools = {
  searchRepo: searchRepoTool,
  readFile: readFileTool,
  gitStatus: gitStatusTool,
  gitDiff: gitDiffTool,
  runCommand: runCommandTool,
  editFile: editFileTool,
};
