import { basename } from "node:path";
import { t } from "./i18n";
import { envWithoutGitState } from "./tool-utils";

export type ShortcutItem = { key: string; description: string };

/** The chord that moves by word, named the way the platform's own keyboard labels it. */
function wordMotionKey(platform: string): string {
  return platform === "darwin" ? "opt + ← / →" : "alt + ← / →";
}

/** Keys only: commands are their own list, reached by typing the `/` this one names. */
export function shortcutItems(platform: string = process.platform): ShortcutItem[] {
  return [
    { key: "/", description: t("tui.help.commands") },
    { key: "@", description: t("tui.help.file_paths") },
    { key: "?", description: t("tui.help.toggle_list") },
    { key: "tab", description: t("tui.help.accept") },
    { key: "→", description: t("tui.help.accept_ghost") },
    { key: "esc", description: t("tui.help.interrupt") },
    { key: "esc", description: t("tui.help.close_list") },
    { key: "ctrl + c", description: t("tui.help.exit") },
    { key: "↑ ↓", description: t("tui.help.history") },
    { key: "shift + ⏎", description: t("tui.help.newline") },
    { key: "ctrl + a / e", description: t("tui.help.line_bounds") },
    { key: "ctrl + w", description: t("tui.help.delete_word") },
    { key: "ctrl + u", description: t("tui.help.clear_line") },
    { key: wordMotionKey(platform), description: t("tui.help.move_word") },
  ];
}

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
  // A session outlives its workspace directory (a removed worktree), and spawning into a
  // missing cwd throws ENOENT synchronously — which would surface as a fatal chat exit.
  try {
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
      env: envWithoutGitState(),
    });
    const [stdoutText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return (await proc.exited) === 0 ? stdoutText : null;
  } catch {
    return null;
  }
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
