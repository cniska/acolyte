import { z } from "zod";
import { appConfig } from "./app-config";
import { gitDiff, gitLog, gitShow, gitStatusShort } from "./core-tools";
import { type ToolkitInput, runTool } from "./core-toolkit";
import { emitHeadTailLines } from "./tool-output-format";
import { createTool } from "./tool-contract";
import { compactToolOutput } from "./tool-output";

const GIT_OPS = ["statusShort", "diff", "log", "show"] as const;
type GitOp = (typeof GIT_OPS)[number];

export type GitDiffInput = { path?: string; contextLines?: number };
export type GitLogInput = { path?: string; limit?: number };
export type GitShowInput = { ref?: string; path?: string; contextLines?: number };

export type GitOps = {
  statusShort: () => Promise<string>;
  diff: (input?: GitDiffInput) => Promise<string>;
  log: (input?: GitLogInput) => Promise<string>;
  show: (input?: GitShowInput) => Promise<string>;
};

export type GitOpsDeps = {
  gitStatusShort: typeof gitStatusShort;
  gitDiff: typeof gitDiff;
  gitLog: typeof gitLog;
  gitShow: typeof gitShow;
};

const defaultDeps: GitOpsDeps = {
  gitStatusShort,
  gitDiff,
  gitLog,
  gitShow,
};

async function runGitOp(operation: GitOp, execute: () => Promise<string>): Promise<string> {
  try {
    return await execute();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[git-ops:${operation}] ${message}`);
  }
}

export function createGitOps(workspace: string, deps: GitOpsDeps = defaultDeps): GitOps {
  return {
    statusShort: () => runGitOp("statusShort", () => deps.gitStatusShort(workspace)),
    diff: (input) => runGitOp("diff", () => deps.gitDiff(workspace, input?.path, input?.contextLines ?? 3)),
    log: (input) =>
      runGitOp("log", () => deps.gitLog(workspace, { path: input?.path, limit: input?.limit })),
    show: (input) =>
      runGitOp("show", () =>
        deps.gitShow(workspace, {
          ref: input?.ref,
          path: input?.path,
          contextLines: input?.contextLines ?? 3,
        }),
      ),
  };
}

function stripGitShowMetadataForPreview(rawText: string): string {
  let inPatch = false;
  return rawText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("Author:") && !trimmed.startsWith("Date:");
    })
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("diff --git ")) inPatch = true;
      if (!inPatch && line.startsWith("    ")) return line.slice(4);
      return line;
    })
    .join("\n");
}

function createGitStatusTool(git: GitOps, input: ToolkitInput) {
  const { session, onToolOutput } = input;
  return createTool({
    id: "git-status",
    description: "Show working tree status (short format with branch) for the current repository.",
    instruction: "Use `git-status` for working tree status.",
    inputSchema: z.object({}).optional(),
    execute: async () => {
      return runTool(session, "git-status", {}, async (toolCallId) => {
        const rawStatus = await git.statusShort();
        emitHeadTailLines("git-status", rawStatus, onToolOutput, toolCallId, { trimStart: true });
        const result = compactToolOutput(rawStatus, appConfig.agent.toolOutputBudget.gitStatus);
        return { result };
      });
    },
  });
}

function createGitDiffTool(git: GitOps, input: ToolkitInput) {
  const { session, onToolOutput } = input;
  return createTool({
    id: "git-diff",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    instruction: "Use `git-diff` for change inspection.",
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "git-diff", toolInput as Record<string, unknown>, async (toolCallId) => {
        const rawDiff = await git.diff({ path: toolInput.path, contextLines: toolInput.contextLines ?? 3 });
        emitHeadTailLines("git-diff", rawDiff, onToolOutput, toolCallId, { headRows: 4, tailRows: 4 });
        const result = compactToolOutput(rawDiff, appConfig.agent.toolOutputBudget.gitDiff);
        return { result };
      });
    },
  });
}

function createGitLogTool(git: GitOps, input: ToolkitInput) {
  const { session, onToolOutput } = input;
  return createTool({
    id: "git-log",
    description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
    instruction: "Use `git-log` to inspect recent commits quickly (optionally scoped by path).",
    inputSchema: z.object({
      path: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "git-log", toolInput as Record<string, unknown>, async (toolCallId) => {
        const rawLog = await git.log({ path: toolInput.path, limit: toolInput.limit });
        emitHeadTailLines("git-log", rawLog, onToolOutput, toolCallId, { trimStart: true });
        const result = compactToolOutput(rawLog, appConfig.agent.toolOutputBudget.gitDiff);
        return { result };
      });
    },
  });
}

function createGitShowTool(git: GitOps, input: ToolkitInput) {
  const { session, onToolOutput } = input;
  return createTool({
    id: "git-show",
    description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
    instruction:
      "Use `git-show` to inspect a specific commit/tag/ref with patch details (optionally scoped by path).",
    inputSchema: z.object({
      ref: z.string().optional(),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "git-show", toolInput as Record<string, unknown>, async (toolCallId) => {
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

export function createGitToolkit(input: ToolkitInput) {
  const git = createGitOps(input.workspace);
  return {
    gitStatus: createGitStatusTool(git, input),
    gitDiff: createGitDiffTool(git, input),
    gitLog: createGitLogTool(git, input),
    gitShow: createGitShowTool(git, input),
  };
}
