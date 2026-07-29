import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { projectResourceIdFromWorkspace } from "./resource-id";
import { expectToThrowJSON, tempDir } from "./test-utils";
import {
  clearWorkspaceSandboxCache,
  ensurePathWithinSandbox,
  resolveProjectRoot,
  resolveWorkspaceSandboxRoot,
} from "./workspace-sandbox";
import { projectWorktreesDir } from "./workspaces-ops";

const dirs = tempDir();

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-c", "commit.gpgsign=false", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t.dev",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t.dev",
    },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`);
}

async function mkdirGitRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

async function createRepoWithWorktree(prefix: string, worktreeAt: (root: string, repo: string) => string) {
  const root = dirs.createDir(prefix);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "README.md"), "repo\n", "utf8");
  await git(repo, ["init", "--initial-branch=main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "init"]);

  await mkdir(join(repo, "docs", "notes"), { recursive: true });
  await writeFile(join(repo, "docs", "notes", "plan.md"), "plan\n", "utf8");

  const worktree = worktreeAt(root, repo);
  await mkdir(dirname(worktree), { recursive: true });
  await git(repo, ["worktree", "add", "-b", "wt", worktree]);
  await mkdir(join(worktree, "docs"), { recursive: true });
  await symlink(join(repo, "docs", "notes"), join(worktree, "docs", "notes"));

  clearWorkspaceSandboxCache();
  return { root, repo, worktree };
}

afterAll(() => {
  clearWorkspaceSandboxCache();
  dirs.cleanupDirs();
});

describe("workspace-sandbox", () => {
  test("allows existing and new paths inside the workspace sandbox", async () => {
    const root = dirs.createDir("acolyte-sandbox-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const existing = join(workspace, "a.txt");
    await writeFile(existing, "ok\n", "utf8");

    const existingResult = ensurePathWithinSandbox(existing, workspace);
    const newResult = ensurePathWithinSandbox("nested/new.txt", workspace);

    expect(existingResult).toBe(existing);
    expect(newResult).toBe(join(workspace, "nested", "new.txt"));
  });

  test("blocks paths outside the workspace sandbox", async () => {
    const root = dirs.createDir("acolyte-sandbox-outside-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });

    expect(() => ensurePathWithinSandbox("/etc/hosts", workspace)).toThrow("Sandbox violation");
    expectToThrowJSON(() => ensurePathWithinSandbox("/etc/hosts", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks symlink escapes for existing targets", async () => {
    const root = dirs.createDir("acolyte-sandbox-symlink-");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });

    const outsideFile = join(outside, "secret.txt");
    await writeFile(outsideFile, "secret\n", "utf8");
    await symlink(outsideFile, join(workspace, "secret-link.txt"));

    expectToThrowJSON(() => ensurePathWithinSandbox("secret-link.txt", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("resolves through a symlinked workspace root", async () => {
    const root = dirs.createDir("acolyte-sandbox-symlink-root-");
    const realWorkspace = join(root, "real");
    const linkedWorkspace = join(root, "linked");
    await mkdir(realWorkspace, { recursive: true });
    await symlink(realWorkspace, linkedWorkspace);

    const file = join(realWorkspace, "a.txt");
    await writeFile(file, "ok\n", "utf8");

    // Files accessible through the symlinked root are allowed
    expect(ensurePathWithinSandbox("a.txt", linkedWorkspace)).toBe(join(linkedWorkspace, "a.txt"));

    // Paths outside both the real and linked root are still blocked
    expectToThrowJSON(() => ensurePathWithinSandbox("/etc/hosts", linkedWorkspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("treats the enclosing repo as the boundary for a subdirectory workspace", async () => {
    const { repo } = await createRepoWithWorktree("acolyte-sandbox-subdir-", (root) => join(root, "outside-wt"));
    const workspace = join(repo, "docs");

    expect(resolveWorkspaceSandboxRoot(workspace)).toBe(await realpath(repo));
    expect(ensurePathWithinSandbox("../README.md", workspace)).toBe(join(repo, "README.md"));
  });

  test("treats the enclosing repo as the boundary for a nested worktree", async () => {
    const { repo, worktree } = await createRepoWithWorktree("acolyte-sandbox-nested-wt-", (_root, repoRoot) =>
      join(repoRoot, ".claude", "worktrees", "wt"),
    );

    expect(resolveWorkspaceSandboxRoot(worktree)).toBe(await realpath(repo));

    // A project-owned path reached through the worktree's symlink resolves inside the repo.
    expect(ensurePathWithinSandbox("docs/notes/plan.md", worktree)).toBe(join(worktree, "docs", "notes", "plan.md"));

    // The primary checkout is part of the same project, so direct traversal reaches it too.
    expect(ensurePathWithinSandbox("../../../README.md", worktree)).toBe(join(repo, "README.md"));

    // Anything outside the repo stays blocked.
    expectToThrowJSON(() => ensurePathWithinSandbox("/etc/hosts", worktree)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("keeps the worktree as the boundary when it sits outside the repo", async () => {
    const { worktree } = await createRepoWithWorktree("acolyte-sandbox-outside-wt-", (root) =>
      join(root, "outside-wt"),
    );

    expect(resolveWorkspaceSandboxRoot(worktree)).toBe(await realpath(worktree));

    expectToThrowJSON(() => ensurePathWithinSandbox("docs/notes/plan.md", worktree)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("identifies a subdirectory and a nested worktree as the same project", async () => {
    const { repo, worktree } = await createRepoWithWorktree("acolyte-project-identity-", (_root, repoRoot) =>
      join(repoRoot, ".claude", "worktrees", "wt"),
    );

    expect(resolveProjectRoot(join(repo, "docs"))).toBe(repo);
    expect(resolveProjectRoot(worktree)).toBe(repo);

    const repoId = projectResourceIdFromWorkspace(repo);
    expect(projectResourceIdFromWorkspace(join(repo, "docs"))).toBe(repoId);
    expect(projectResourceIdFromWorkspace(worktree)).toBe(repoId);

    // Worktree storage and memory must name the same project.
    expect(projectWorktreesDir(worktree)).toBe(projectWorktreesDir(repo));
  });

  test("identifies a path that is not a repository as itself", () => {
    const root = dirs.createDir("acolyte-project-identity-nonrepo-");

    expect(resolveProjectRoot(root)).toBe(root);
    // Neither existing nor a repository — memory scope must still resolve, not throw.
    expect(resolveProjectRoot("/ws/one")).toBe("/ws/one");
    expect(projectResourceIdFromWorkspace("/ws/one")).toBe(projectResourceIdFromWorkspace("/ws/one"));
  });

  test("never widens the boundary to a repository at or above the home directory", async () => {
    const root = await realpath(dirs.createDir("acolyte-sandbox-git-home-"));
    const home = join(root, "home");
    const project = join(home, "code", "project");
    await mkdir(project, { recursive: true });
    await git(await mkdirGitRepo(home), ["init"]);
    await git(await mkdirGitRepo(project), ["init"]);

    const priorHome = process.env.HOME;
    process.env.HOME = home;
    clearWorkspaceSandboxCache();
    try {
      // The project's own repository still wins — it is below home.
      expect(resolveWorkspaceSandboxRoot(project)).toBe(project);
      expect(resolveProjectRoot(project)).toBe(project);

      // A directory under a git-tracked home that is not itself a repository keeps its own root
      // rather than widening to all of home.
      const plain = join(home, "notes");
      await mkdir(plain, { recursive: true });
      expect(resolveWorkspaceSandboxRoot(plain)).toBe(plain);
    } finally {
      process.env.HOME = priorHome;
      clearWorkspaceSandboxCache();
    }
  });

  test("blocks symlink escapes for new files under symlinked directories", async () => {
    const root = dirs.createDir("acolyte-sandbox-parent-");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });

    await symlink(outside, join(workspace, "out"));

    expectToThrowJSON(() => ensurePathWithinSandbox("out/new-file.txt", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });
});
