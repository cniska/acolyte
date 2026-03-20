import { z } from "zod";
import { gitAdd, gitCommit, gitDiff, gitLog, gitShow, gitStatusShort } from "./git-ops";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitHeadTailLines, emitResultChunks, TOOL_OUTPUT_LIMITS } from "./tool-output-format";

const GIT_OPS = ["statusShort", "diff", "log", "show", "add", "commit"] as const;
type GitOp = (typeof GIT_OPS)[number];

export type GitDiffInput = { path?: string; contextLines?: number };
export type GitLogInput = { path?: string; limit?: number };
export type GitShowInput = { ref?: string; path?: string; contextLines?: number };
export type GitAddInput = { paths?: string[]; all?: boolean };
export type GitCommitInput = { message: string; body?: string[] };

export type GitOps = {
  statusShort: () => Promise<string>;
  diff: (input?: GitDiffInput) => Promise<string>;
  log: (input?: GitLogInput) => Promise<string>;
  show: (input?: GitShowInput) => Promise<string>;
  add: (input?: GitAddInput) => Promise<string>;
  commit: (input: GitCommitInput) => Promise<string>;
};

export type GitOpsDeps = {
  gitStatusShort: typeof gitStatusShort;
  gitDiff: typeof gitDiff;
  gitLog: typeof gitLog;
  gitShow: typeof gitShow;
  gitAdd: typeof gitAdd;
  gitCommit: typeof gitCommit;
};

const defaultDeps: GitOpsDeps = {
  gitStatusShort,
  gitDiff,
  gitLog,
  gitShow,
  gitAdd,
  gitCommit,
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
    log: (input) => runGitOp("log", () => deps.gitLog(workspace, { path: input?.path, limit: input?.limit })),
    show: (input) =>
      runGitOp("show", () =>
        deps.gitShow(workspace, {
          ref: input?.ref,
          path: input?.path,
          contextLines: input?.contextLines ?? 3,
        }),
      ),
    add: (input) => runGitOp("add", () => deps.gitAdd(workspace, { paths: input?.paths, all: input?.all })),
    commit: (input) => runGitOp("commit", () => deps.gitCommit(workspace, input)),
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

function createGitStatusTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-status",
    labelKey: "git_status",
    category: "search",
    permissions: ["read"],
    description: "Show working tree status (short format with branch) for the current repository.",
    instruction:
      "Use `git-status` when repository state itself matters, not to re-check a file-scoped task you already understand from the task and tool results.",
    outputSchema: z.object({
      kind: z.literal("git-status"),
      output: z.string(),
    }),
    inputSchema: z.object({}).optional(),
    execute: async (_toolInput, toolCallId) => {
      return runTool(input.session, "git-status", toolCallId, {}, async (callId) => {
        input.onOutput({
          toolName: "git-status",
          content: { kind: "tool-header", labelKey: "git_status" },
          toolCallId: callId,
        });
        const rawStatus = await git.statusShort();
        emitHeadTailLines("git-status", rawStatus, input.onOutput, callId);
        const result = compactToolOutput(rawStatus, deps.outputBudget.gitStatus);
        return { kind: "git-status", output: result };
      });
    },
  });
}

function createGitDiffTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-diff",
    labelKey: "git_diff",
    category: "search",
    permissions: ["read"],
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    instruction:
      "Use `git-diff` when repository diff context matters, not to re-check an edit you just made. For explicit named-file bounded tasks, trust the write-tool diff preview and stop unless the user asked for verification or git context.",
    outputSchema: z.object({
      kind: z.literal("git-diff"),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20),
      output: z.string(),
    }),
    inputSchema: z.object({
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "git-diff", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "git-diff",
          content: { kind: "tool-header", labelKey: "git_diff", detail: toolInput.path },
          toolCallId: callId,
        });
        const rawDiff = await git.diff({ path: toolInput.path, contextLines: toolInput.contextLines ?? 3 });
        emitHeadTailLines("git-diff", rawDiff, input.onOutput, callId, { headRows: 2, tailRows: 2 });
        const result = compactToolOutput(rawDiff, deps.outputBudget.gitDiff);
        return { kind: "git-diff", path: toolInput.path, contextLines: toolInput.contextLines ?? 3, output: result };
      });
    },
  });
}

function createGitLogTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-log",
    labelKey: "git_log",
    category: "search",
    permissions: ["read"],
    description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
    instruction:
      "Use `git-log` to inspect committed history quickly, optionally scoped by path. It is for history, not current uncommitted edits.",
    outputSchema: z.object({
      kind: z.literal("git-log"),
      path: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      output: z.string(),
    }),
    inputSchema: z.object({
      path: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "git-log", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "git-log",
          content: { kind: "tool-header", labelKey: "git_log", detail: toolInput.path },
          toolCallId: callId,
        });
        const rawLog = await git.log({ path: toolInput.path, limit: toolInput.limit });
        emitResultChunks("git-log", rawLog, input.onOutput, 4, callId);
        const result = compactToolOutput(rawLog, deps.outputBudget.gitDiff);
        return { kind: "git-log", path: toolInput.path, limit: toolInput.limit, output: result };
      });
    },
  });
}

function createGitShowTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-show",
    labelKey: "git_show",
    category: "search",
    permissions: ["read"],
    description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
    instruction:
      "Use `git-show` to inspect committed history for a specific ref, optionally scoped by path. It is for history, not current uncommitted edits.",
    outputSchema: z.object({
      kind: z.literal("git-show"),
      ref: z.string().optional(),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20),
      output: z.string(),
    }),
    inputSchema: z.object({
      ref: z.string().optional(),
      path: z.string().optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "git-show", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "git-show",
          content: { kind: "tool-header", labelKey: "git_show", detail: toolInput.ref ?? toolInput.path },
          toolCallId: callId,
        });
        const rawShow = await git.show({
          ref: toolInput.ref,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? 3,
        });
        emitHeadTailLines("git-show", stripGitShowMetadataForPreview(rawShow), input.onOutput, callId);
        const result = compactToolOutput(rawShow, deps.outputBudget.gitDiff);
        return {
          kind: "git-show",
          ref: toolInput.ref,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? 3,
          output: result,
        };
      });
    },
  });
}

function createGitAddTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-add",
    labelKey: "git_add",
    category: "write",
    permissions: ["write"],
    description:
      "Stage tracked/untracked files. Prefer explicit `paths` scoped to files edited in the current task. Use `all=true` only when explicitly needed.",
    instruction: "Use `git-add` to stage edited files before commit. Prefer explicit paths over `all=true`.",
    outputSchema: z.object({
      kind: z.literal("git-add"),
      all: z.boolean().optional(),
      paths: z.array(z.string().min(1)).optional(),
      output: z.string(),
    }),
    inputSchema: z.object({
      paths: z.array(z.string().min(1)).max(200).optional(),
      all: z.boolean().optional(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "git-add", toolCallId, toolInput, async (callId) => {
        const paths = (toolInput.paths ?? []).filter((p) => p.trim().length > 0);
        const addDetail = toolInput.all === true ? "all" : `${paths.length} files`;
        input.onOutput({
          toolName: "git-add",
          content: { kind: "tool-header", labelKey: "git_add", detail: addDetail },
          toolCallId: callId,
        });
        const rawAdd = await git.add({ paths: toolInput.paths, all: toolInput.all });
        if (paths.length > 0) {
          for (const p of paths.slice(0, TOOL_OUTPUT_LIMITS.files)) {
            input.onOutput({ toolName: "git-add", content: { kind: "text", text: p }, toolCallId: callId });
          }
          if (paths.length > TOOL_OUTPUT_LIMITS.files) {
            input.onOutput({
              toolName: "git-add",
              content: { kind: "truncated", count: paths.length - TOOL_OUTPUT_LIMITS.files, unit: "files" },
              toolCallId: callId,
            });
          }
        }
        const result = compactToolOutput(rawAdd, deps.outputBudget.gitStatus);
        return { kind: "git-add", all: toolInput.all, paths: toolInput.paths, output: result };
      });
    },
  });
}

function createGitCommitTool(git: GitOps, deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "git-commit",
    labelKey: "git_commit",
    category: "write",
    permissions: ["write"],
    description: "Create a git commit with a required subject line and optional body lines.",
    instruction:
      "Use `git-commit` to create the final Conventional Commit after verify passes. Set `message` to the subject line. Never commit unless the user explicitly asks you to.",
    outputSchema: z.object({
      kind: z.literal("git-commit"),
      message: z.string().min(1),
      body: z.array(z.string().min(1)).optional(),
      output: z.string(),
    }),
    inputSchema: z.object({
      message: z.string().min(1),
      body: z.array(z.string().min(1)).max(10).optional(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "git-commit", toolCallId, toolInput, async (callId) => {
        const rawCommit = await git.commit({ message: toolInput.message, body: toolInput.body });
        const hashMatch = rawCommit.match(/^\[[\w/.-]+\s+([a-f0-9]+)\]/);
        const shortHash = hashMatch?.[1];
        const detail = shortHash ? `${toolInput.message} (${shortHash})` : toolInput.message;
        input.onOutput({
          toolName: "git-commit",
          content: { kind: "tool-header", labelKey: "git_commit", detail },
          toolCallId: callId,
        });
        if (toolInput.body && toolInput.body.length > 0) {
          const maxBodyLines = TOOL_OUTPUT_LIMITS.files;
          for (const line of toolInput.body.slice(0, maxBodyLines)) {
            input.onOutput({ toolName: "git-commit", content: { kind: "text", text: line }, toolCallId: callId });
          }
          if (toolInput.body.length > maxBodyLines) {
            input.onOutput({
              toolName: "git-commit",
              content: { kind: "truncated", count: toolInput.body.length - maxBodyLines, unit: "lines" },
              toolCallId: callId,
            });
          }
        }
        const result = compactToolOutput(rawCommit, deps.outputBudget.gitDiff);
        return { kind: "git-commit", message: toolInput.message, body: toolInput.body, output: result };
      });
    },
  });
}

export function createGitToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  const git = createGitOps(input.workspace);
  return {
    gitStatus: createGitStatusTool(git, deps, input),
    gitDiff: createGitDiffTool(git, deps, input),
    gitLog: createGitLogTool(git, deps, input),
    gitShow: createGitShowTool(git, deps, input),
    gitAdd: createGitAddTool(git, deps, input),
    gitCommit: createGitCommitTool(git, deps, input),
  };
}
