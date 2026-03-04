import { createTool } from "./tool-contract";
import { z } from "zod";
import { appConfig } from "./app-config";
import type { GitToolkit } from "./git-tools";
import { runToolAdapter, type ToolAdapterRuntime } from "./tool-adapter";
import type { ToolName } from "./tool-names";
import { compactToolOutput } from "./tool-output";
import type { ToolOutputListener } from "./tool-output-format";

type EmitHeadTailLines = (
  toolName: ToolName,
  rawText: string,
  onToolOutput: ToolOutputListener | undefined,
  toolCallId: string,
  options?: { headRows?: number; tailRows?: number; trimStart?: boolean },
) => void;

type GitToolFactoryInput = {
  git: GitToolkit;
  runtime: ToolAdapterRuntime;
  onToolOutput?: ToolOutputListener;
  emitHeadTailLines: EmitHeadTailLines;
  stripGitShowMetadataForPreview: (rawText: string) => string;
};

function createGitStatusTool(input: GitToolFactoryInput) {
  const { git, runtime, onToolOutput, emitHeadTailLines } = input;
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    inputSchema: z.object({}).optional(),
    execute: async () => {
      return runToolAdapter(runtime, "git-status", {}, async (toolCallId) => {
        const rawStatus = await git.statusShort();
        emitHeadTailLines("git-status", rawStatus, onToolOutput, toolCallId, { trimStart: true });
        const result = compactToolOutput(rawStatus, appConfig.agent.toolOutputBudget.gitStatus);
        return { result };
      });
    },
  });
}

function createGitDiffTool(input: GitToolFactoryInput) {
  const { git, runtime, onToolOutput, emitHeadTailLines } = input;
  return createTool({
    id: "git-diff",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput) => {
      return runToolAdapter(runtime, "git-diff", toolInput as Record<string, unknown>, async (toolCallId) => {
        const rawDiff = await git.diff({ path: toolInput.path, contextLines: toolInput.contextLines ?? 3 });
        emitHeadTailLines("git-diff", rawDiff, onToolOutput, toolCallId, { headRows: 4, tailRows: 4 });
        const result = compactToolOutput(rawDiff, appConfig.agent.toolOutputBudget.gitDiff);
        return { result };
      });
    },
  });
}

function createGitLogTool(input: GitToolFactoryInput) {
  const { git, runtime, onToolOutput, emitHeadTailLines } = input;
  return createTool({
    id: "git-log",
    description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
    inputSchema: z.object({
      path: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (toolInput) => {
      return runToolAdapter(runtime, "git-log", toolInput as Record<string, unknown>, async (toolCallId) => {
        const rawLog = await git.log({ path: toolInput.path, limit: toolInput.limit });
        emitHeadTailLines("git-log", rawLog, onToolOutput, toolCallId, { trimStart: true });
        const result = compactToolOutput(rawLog, appConfig.agent.toolOutputBudget.gitStatus);
        return { result };
      });
    },
  });
}

function createGitShowTool(input: GitToolFactoryInput) {
  const { git, runtime, onToolOutput, emitHeadTailLines, stripGitShowMetadataForPreview } = input;
  return createTool({
    id: "git-show",
    description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
    inputSchema: z.object({
      ref: z.string().optional(),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput) => {
      return runToolAdapter(runtime, "git-show", toolInput as Record<string, unknown>, async (toolCallId) => {
        const rawShow = await git.show({
          ref: toolInput.ref,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? 3,
        });
        emitHeadTailLines("git-show", stripGitShowMetadataForPreview(rawShow), onToolOutput, toolCallId, {
          headRows: 4,
          tailRows: 4,
        });
        const result = compactToolOutput(rawShow, appConfig.agent.toolOutputBudget.gitDiff);
        return { result };
      });
    },
  });
}

export function createMastraGitTools(input: GitToolFactoryInput) {
  return {
    gitStatus: {
      tool: createGitStatusTool(input),
      meta: {
        description: "Show working tree status (short format with branch) for the current repository.",
        instruction: "Use `git-status` for working tree status.",
        aliases: ["gitStatus", "git_status"],
      },
    },
    gitDiff: {
      tool: createGitDiffTool(input),
      meta: {
        description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
        instruction: "Use `git-diff` for change inspection.",
        aliases: ["gitDiff", "git_diff"],
      },
    },
    gitLog: {
      tool: createGitLogTool(input),
      meta: {
        description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
        instruction: "Use `git-log` to inspect recent commits quickly (optionally scoped by path).",
        aliases: ["gitLog", "git_log"],
      },
    },
    gitShow: {
      tool: createGitShowTool(input),
      meta: {
        description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
        instruction:
          "Use `git-show` to inspect a specific commit/tag/ref with patch details (optionally scoped by path).",
        aliases: ["gitShow", "git_show"],
      },
    },
  };
}
