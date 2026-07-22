import { basename } from "node:path";
import { slashCommandHelp } from "./chat-slash";
import { t } from "./i18n";

/** Terminal width at which help pane switches from 1 to 2 columns. */
export const BREAKPOINT_TWO_COLUMN = 92;

export const SHORTCUT_ITEMS = [
  { key: "@path", description: t("chat.at_ref.attach_file") },
  { key: "/new", description: slashCommandHelp("/new") },
  { key: "/resume <id>", description: slashCommandHelp("/resume") },
  { key: "/sessions", description: slashCommandHelp("/sessions") },
  { key: "/workspaces", description: slashCommandHelp("/workspaces") },
  { key: "/model", description: slashCommandHelp("/model") },
  { key: "/status", description: slashCommandHelp("/status") },
  { key: "/memory [scope]", description: slashCommandHelp("/memory") },
  { key: "/memory add <text>", description: slashCommandHelp("/memory add") },
  { key: "/usage", description: slashCommandHelp("/usage") },
  { key: "/skills", description: slashCommandHelp("/skills") },
  { key: "/exit", description: slashCommandHelp("/exit") },
] as const;

export type GitStatus = {
  /** Repo name (main working-tree root basename); null outside a git repo. */
  repo: string | null;
  /** Linked-worktree name, when the cwd is inside one. */
  worktree: string | null;
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
};

async function git(cwd: string, args: string[]): Promise<string | null> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [stdoutText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return (await proc.exited) === 0 ? stdoutText : null;
}

export async function gitStatus(cwd = process.cwd()): Promise<GitStatus | null> {
  const absoluteGitDir = (await git(cwd, ["rev-parse", "--absolute-git-dir"]))?.trim();
  if (!absoluteGitDir) return null;

  let worktree: string | null = null;
  let mainRoot: string;
  if (/\/worktrees\/[^/]+$/.test(absoluteGitDir)) {
    worktree = basename(absoluteGitDir);
    mainRoot = absoluteGitDir.replace(/\/\.git\/worktrees\/[^/]+$/, "");
  } else {
    mainRoot = absoluteGitDir.replace(/\/\.git$/, "");
  }

  let branch: string | null = null;
  let dirty = false;
  let ahead = 0;
  let behind = 0;
  const status = await git(cwd, ["--no-optional-locks", "status", "--porcelain=v2", "--branch"]);
  for (const line of (status ?? "").split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      branch = head === "(detached)" ? null : head;
    } else if (line.startsWith("# branch.ab ")) {
      const ab = line.match(/\+(\d+) -(\d+)/);
      if (ab) {
        ahead = Number(ab[1]);
        behind = Number(ab[2]);
      }
    } else if (line.length > 0 && !line.startsWith("#")) {
      dirty = true;
    }
  }
  if (branch === null) {
    branch = (await git(cwd, ["rev-parse", "--short", "HEAD"]))?.trim() || null;
  }

  return { repo: basename(mainRoot), worktree, branch, dirty, ahead, behind };
}
