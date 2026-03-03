import { gitDiff, gitLog, gitShow, gitStatusShort } from "./core-tools";

export const GIT_TOOLKIT_OPERATIONS = ["statusShort", "diff", "log", "show"] as const;
export type GitToolkitOperation = (typeof GIT_TOOLKIT_OPERATIONS)[number];

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
    throw new Error(`[git-tools:${operation}] ${message}`);
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
