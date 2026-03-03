import { gitDiff, gitLog, gitShow, gitStatusShort } from "./tools";

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

async function runGitToolkitOperation(operation: GitToolkitOperation, execute: () => Promise<string>): Promise<string> {
  try {
    return await execute();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[git-toolkit:${operation}] ${message}`);
  }
}

export function createGitToolkit(workspace: string): GitToolkit {
  return {
    statusShort: () => runGitToolkitOperation("statusShort", () => gitStatusShort(workspace)),
    diff: (input) => runGitToolkitOperation("diff", () => gitDiff(workspace, input?.path, input?.contextLines ?? 3)),
    log: (input) => runGitToolkitOperation("log", () => gitLog(workspace, { path: input?.path, limit: input?.limit })),
    show: (input) =>
      runGitToolkitOperation("show", () =>
        gitShow(workspace, {
          ref: input?.ref,
          path: input?.path,
          contextLines: input?.contextLines ?? 3,
        }),
      ),
  };
}
