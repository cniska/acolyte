import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectLabelFromWorkspace, projectResourceIdForLabel, projectResourceIdFromWorkspace } from "./resource-id";
import { gitEnv, tempDir } from "./test-utils";
import { clearWorkspaceSandboxCache } from "./workspace-sandbox";

const dirs = tempDir();

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-c", "commit.gpgsign=false", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnv({
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t.dev",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t.dev",
    }),
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`);
  }
}

async function createRepo(prefix: string, origin?: string): Promise<string> {
  const repo = join(dirs.createDir(prefix), "repo");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "README.md"), "repo\n", "utf8");
  await git(repo, ["init", "--initial-branch=main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "init"]);
  if (origin) await git(repo, ["remote", "add", "origin", origin]);
  clearWorkspaceSandboxCache();
  return repo;
}

afterEach(() => {
  clearWorkspaceSandboxCache();
});

describe("project resource id", () => {
  test("identifies a repository by its origin remote", async () => {
    const repo = await createRepo("acolyte-proj-id-remote-", "git@github.com:acolyte-sh/acolyte.git");

    expect(projectLabelFromWorkspace(repo)).toBe("acolyte-sh/acolyte");
    expect(projectResourceIdFromWorkspace(repo)).toBe(projectResourceIdForLabel("acolyte-sh/acolyte"));
  });

  test("sees a remote added after the first lookup", async () => {
    const repo = await createRepo("acolyte-proj-id-late-remote-");
    expect(projectResourceIdFromWorkspace(repo)).toBeNull();

    await git(repo, ["remote", "add", "origin", "git@github.com:acolyte-sh/acolyte.git"]);

    expect(projectResourceIdFromWorkspace(repo)).toBe(projectResourceIdForLabel("acolyte-sh/acolyte"));
  });

  test("follows a remote that is repointed at another repository", async () => {
    const repo = await createRepo("acolyte-proj-id-repointed-", "git@github.com:acolyte-sh/acolyte.git");
    expect(projectResourceIdFromWorkspace(repo)).toBe(projectResourceIdForLabel("acolyte-sh/acolyte"));

    await git(repo, ["remote", "set-url", "origin", "git@github.com:acolyte-sh/other.git"]);

    expect(projectResourceIdFromWorkspace(repo)).toBe(projectResourceIdForLabel("acolyte-sh/other"));
  });

  test("gives two checkouts of one repository the same id", async () => {
    const one = await createRepo("acolyte-proj-id-first-", "https://github.com/acolyte-sh/acolyte.git");
    const two = await createRepo("acolyte-proj-id-second-", "git@github.com:acolyte-sh/acolyte.git");

    expect(projectResourceIdFromWorkspace(one)).toBe(projectResourceIdFromWorkspace(two));
  });

  test("gives a linked worktree the id of the repository it belongs to", async () => {
    const repo = await createRepo("acolyte-proj-id-worktree-", "https://github.com/acolyte-sh/acolyte.git");
    const worktree = join(dirs.createDir("acolyte-proj-id-worktree-linked-"), "wt");
    await git(repo, ["worktree", "add", "-b", "topic", worktree]);
    clearWorkspaceSandboxCache();

    expect(projectResourceIdFromWorkspace(worktree)).toBe(projectResourceIdForLabel("acolyte-sh/acolyte"));
  });

  test("gives a checkout with no origin no project id", async () => {
    const repo = await createRepo("acolyte-proj-id-no-remote-");

    expect(projectResourceIdFromWorkspace(repo)).toBeNull();
  });

  test("gives a workspace that is not a repository no project id", () => {
    expect(projectResourceIdFromWorkspace(dirs.createDir("acolyte-proj-id-nonrepo-"))).toBeNull();
  });
});
