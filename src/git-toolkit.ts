import { gitDiff, gitLog, gitShow, gitStatusShort } from "./tools";

export const GIT_TOOLKIT_OPERATIONS = ["statusShort", "diff", "log", "show"] as const;
export type GitToolkitOperation = (typeof GIT_TOOLKIT_OPERATIONS)[number];

export const gitToolMeta = {
  "git-status": {
    instruction: "Use `git-status` for working tree status.",
    aliases: ["gitStatus", "git_status"],
  },
  "git-diff": {
    instruction: "Use `git-diff` for change inspection.",
    aliases: ["gitDiff", "git_diff"],
  },
  "git-log": {
    instruction: "Use `git-log` to inspect recent commits quickly (optionally scoped by path).",
    aliases: ["gitLog", "git_log"],
  },
  "git-show": {
    instruction: "Use `git-show` to inspect a specific commit/tag/ref with patch details (optionally scoped by path).",
    aliases: ["gitShow", "git_show"],
  },
} as const;

export type GitDiffInput = { path?: string; contextLines?: number };
export type GitLogInput = { path?: string; limit?: number };
export type GitShowInput = { ref?: string; path?: string; contextLines?: number };

export type GitToolkit = {
  statusShort: () => Promise<string>;
  diff: (input?: GitDiffInput) => Promise<string>;
  log: (input?: GitLogInput) => Promise<string>;
  show: (input?: GitShowInput) => Promise<string>;
};

export type GitToolkitDeps = {
  gitStatusShort: typeof gitStatusShort;
  gitDiff: typeof gitDiff;
  gitLog: typeof gitLog;
  gitShow: typeof gitShow;
};

const defaultDeps: GitToolkitDeps = {
  gitStatusShort,
  gitDiff,
  gitLog,
  gitShow,
};

async function runGitToolkitOperation(operation: GitToolkitOperation, execute: () => Promise<string>): Promise<string> {
  try {
    return await execute();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[git-toolkit:${operation}] ${message}`);
  }
}

export function createGitToolkit(workspace: string, deps: GitToolkitDeps = defaultDeps): GitToolkit {
  return {
    statusShort: () => runGitToolkitOperation("statusShort", () => deps.gitStatusShort(workspace)),
    diff: (input) =>
      runGitToolkitOperation("diff", () => deps.gitDiff(workspace, input?.path, input?.contextLines ?? 3)),
    log: (input) =>
      runGitToolkitOperation("log", () => deps.gitLog(workspace, { path: input?.path, limit: input?.limit })),
    show: (input) =>
      runGitToolkitOperation("show", () =>
        deps.gitShow(workspace, {
          ref: input?.ref,
          path: input?.path,
          contextLines: input?.contextLines ?? 3,
        }),
      ),
  };
}
