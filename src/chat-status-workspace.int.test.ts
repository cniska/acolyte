import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { useChatState } from "./chat-state";
import { createClient, createSession, createSessionState, tempDir } from "./test-utils";
import { renderHook } from "./tui/test-utils";

const dirs = tempDir();

afterEach(dirs.cleanupDirs);

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

/** A repository with one linked worktree; returns the worktree path and its name. */
async function createRepoWithWorktree(): Promise<{ root: string; worktree: string; name: string }> {
  const root = dirs.createDir("acolyte-status-repo-");
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.email", "test@acolyte.test"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await Bun.write(join(root, "README.md"), "seed\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "seed"]);

  const name = "side-quest";
  const worktree = join(root, ".acolyte", "worktrees", name);
  await git(root, ["worktree", "add", "-b", name, worktree]);
  return { root, worktree, name };
}

function statusFor(workspace: string | undefined) {
  const session = createSession({ id: "sess_status01", workspace });
  const sessionState = createSessionState({ sessions: [session], activeSessionId: session.id });
  return renderHook(() =>
    useChatState(
      {
        client: createClient({ status: async () => ({}) }),
        session,
        sessionState,
        persist: async () => {},
        version: "0.0.0-test",
      },
      () => {},
    ),
  );
}

describe("footer git context", () => {
  test("names the session's worktree rather than the process working directory", async () => {
    const { name, worktree } = await createRepoWithWorktree();
    const { result, unmount } = statusFor(worktree);
    try {
      await Bun.sleep(600);
      expect(result.current.statusLine.worktree).toBe(name);
      expect(result.current.statusLine.branch).toBe(name);
    } finally {
      unmount();
    }
  });

  test("reports the session's repository, not the one the client was launched from", async () => {
    const { root } = await createRepoWithWorktree();
    const { result, unmount } = statusFor(root);
    try {
      await Bun.sleep(600);
      expect(result.current.statusLine.worktree).toBeNull();
      expect(result.current.statusLine.repo).not.toBe("acolyte");
    } finally {
      unmount();
    }
  });
});
