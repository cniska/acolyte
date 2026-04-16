import { z } from "zod";
import { errorMessage } from "./error-contract";
import { gitAdd, gitCommit, gitDiff, gitLog, gitShow, gitStatusShort } from "./git-ops";
import { t } from "./i18n";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";
import { emitParts, resultChunkParts, textHeadTailParts } from "./tool-output-format";

const DEFAULT_CONTEXT_LINES = 3;

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
    const message = errorMessage(error);
    throw new Error(`[git-ops:${operation}] ${message}`);
  }
}

export function createGitOps(workspace: string, deps: GitOpsDeps = defaultDeps): GitOps {
  return {
    statusShort: () => runGitOp("statusShort", () => deps.gitStatusShort(workspace)),
    diff: (input) =>
      runGitOp("diff", () => deps.gitDiff(workspace, input?.path, input?.contextLines ?? DEFAULT_CONTEXT_LINES)),
    log: (input) => runGitOp("log", () => deps.gitLog(workspace, { path: input?.path, limit: input?.limit })),
    show: (input) =>
      runGitOp("show", () =>
        deps.gitShow(workspace, {
          ref: input?.ref,
          path: input?.path,
          contextLines: input?.contextLines ?? DEFAULT_CONTEXT_LINES,
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

function createGitStatusTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-status",
    toolkit: "git",
    category: "search",
    description: "Show working tree status (short format with branch) for the current repository.",
    instruction: "Use `git-status` when repo-wide state matters. Skip it for already-understood file-scoped edits.",
    outputSchema: z.object({
      kind: z.literal("git-status"),
      output: z.string(),
    }),
    inputSchema: z.object({}).optional(),
    execute: async (_toolInput, toolCallId) => {
      return runTool(input.session, "git-status", toolCallId, {}, async (callId) => {
        input.onOutput({
          toolName: "git-status",
          content: { kind: "tool-header", labelKey: "tool.label.git_status" },
          toolCallId: callId,
        });
        const rawStatus = await git.statusShort();
        const previewParts = textHeadTailParts(rawStatus);
        emitParts(previewParts, "git-status", input.onOutput, callId);
        return { kind: "git-status" as const, output: rawStatus };
      });
    },
  });
}

function createGitDiffTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-diff",
    toolkit: "git",
    category: "search",
    description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
    instruction:
      "Use `git-diff` when git-level diff context matters. For bounded file edits, rely on write-tool previews unless the user asks for git verification.",
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
          content: { kind: "tool-header", labelKey: "tool.label.git_diff", detail: toolInput.path },
          toolCallId: callId,
        });
        const rawDiff = await git.diff({
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? DEFAULT_CONTEXT_LINES,
        });
        const previewParts = textHeadTailParts(rawDiff, { headRows: 2, tailRows: 2 });
        emitParts(previewParts, "git-diff", input.onOutput, callId);
        return {
          kind: "git-diff" as const,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? DEFAULT_CONTEXT_LINES,
          output: rawDiff,
        };
      });
    },
  });
}

function createGitLogTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-log",
    toolkit: "git",
    category: "search",
    description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
    instruction: "Use `git-log` for committed history (optionally scoped by path), not for uncommitted edits.",
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
          content: { kind: "tool-header", labelKey: "tool.label.git_log", detail: toolInput.path },
          toolCallId: callId,
        });
        const rawLog = await git.log({ path: toolInput.path, limit: toolInput.limit });
        const previewParts = resultChunkParts(rawLog, 4);
        emitParts(previewParts, "git-log", input.onOutput, callId);
        return { kind: "git-log" as const, path: toolInput.path, limit: toolInput.limit, output: rawLog };
      });
    },
  });
}

function createGitShowTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-show",
    toolkit: "git",
    category: "search",
    description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
    instruction:
      "Use `git-show` for committed history at a ref (optionally scoped by path), not for uncommitted edits.",
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
          content: { kind: "tool-header", labelKey: "tool.label.git_show", detail: toolInput.ref ?? toolInput.path },
          toolCallId: callId,
        });
        const rawShow = await git.show({
          ref: toolInput.ref,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? DEFAULT_CONTEXT_LINES,
        });
        const previewText = stripGitShowMetadataForPreview(rawShow);
        const previewParts = textHeadTailParts(previewText);
        emitParts(previewParts, "git-show", input.onOutput, callId);
        return {
          kind: "git-show" as const,
          ref: toolInput.ref,
          path: toolInput.path,
          contextLines: toolInput.contextLines ?? DEFAULT_CONTEXT_LINES,
          output: rawShow,
        };
      });
    },
  });
}

function createGitAddTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-add",
    toolkit: "git",
    category: "write",
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
        const addDetail = toolInput.all === true ? "all" : t("unit.file", { count: paths.length });
        input.onOutput({
          toolName: "git-add",
          content: { kind: "tool-header", labelKey: "tool.label.git_add", detail: addDetail },
          toolCallId: callId,
        });
        const rawAdd = await git.add({ paths: toolInput.paths, all: toolInput.all });
        if (paths.length > 0) {
          emitParts(textHeadTailParts(paths.join("\n")), "git-add", input.onOutput, callId);
        }
        return { kind: "git-add" as const, all: toolInput.all, paths: toolInput.paths, output: rawAdd };
      });
    },
  });
}

function createGitCommitTool(git: GitOps, input: ToolkitInput) {
  return createTool({
    id: "git-commit",
    toolkit: "git",
    category: "write",
    description: "Create a git commit with a required subject line and optional body lines.",
    instruction: "Use `git-commit` only when the user explicitly asks. Set `message` to the subject line.",
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
          content: { kind: "tool-header", labelKey: "tool.label.git_commit", detail },
          toolCallId: callId,
        });
        for (const line of toolInput.body ?? []) {
          input.onOutput({ toolName: "git-commit", content: { kind: "text", text: line }, toolCallId: callId });
        }
        return { kind: "git-commit" as const, message: toolInput.message, body: toolInput.body, output: rawCommit };
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
    gitAdd: createGitAddTool(git, input),
    gitCommit: createGitCommitTool(git, input),
  };
}
