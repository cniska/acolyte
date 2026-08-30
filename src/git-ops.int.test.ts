import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { gitShow } from "./git-ops";
import { gitEnv, tempDir } from "./test-utils";
import { runCommand } from "./tool-utils";

const dirs = tempDir();
const ISOLATED_GIT_CONFIG = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull };

afterAll(() => {
  dirs.cleanupDirs();
});

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", ...args], cwd, ISOLATED_GIT_CONFIG);
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`);
  return stdout.trim();
}

async function createTempRepo(prefix: string): Promise<string> {
  const dirPath = dirs.createDir(prefix);
  await runGit(dirPath, ["init", "-b", "main"]);
  await runGit(dirPath, ["config", "user.email", "test@example.com"]);
  await runGit(dirPath, ["config", "user.name", "Test"]);
  return dirPath;
}

describe("requireGitVersion", () => {
  // The resolved version is memoized per process and the suite shares one, so any earlier git call
  // would satisfy this. A child process with an empty PATH is the only way to reach the cold path.
  test("names git as the missing prerequisite when it is not on PATH", async () => {
    const script = `
      const { requireGitVersion } = await import(${JSON.stringify(join(import.meta.dir, "git-ops.ts"))});
      const failure = await requireGitVersion().catch((error) => error);
      console.log(JSON.stringify({ code: failure.code, message: failure.message }));
    `;
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", script],
      env: gitEnv({ PATH: mkdtempSync(join(tmpdir(), "acolyte-nogit-")) }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    const failure = JSON.parse(stdout.trim());

    expect(failure.code).toBe(TOOL_ERROR_CODES.gitUnavailable);
    expect(failure.message).toContain("2.14");
  });
});

describe("gitShow", () => {
  test("reads file contents at a ref when the commit did not touch the path", async () => {
    const dirPath = await createTempRepo("acolyte-gitshow-blob-");
    await writeFile(join(dirPath, "tracked.txt"), "first version\n", "utf8");
    await runGit(dirPath, ["add", "tracked.txt"]);
    await runGit(dirPath, ["commit", "-m", "add tracked"]);
    await writeFile(join(dirPath, "other.txt"), "unrelated\n", "utf8");
    await runGit(dirPath, ["add", "other.txt"]);
    await runGit(dirPath, ["commit", "-m", "touch other"]);

    const output = await gitShow(dirPath, { ref: "HEAD", path: "tracked.txt" }, ISOLATED_GIT_CONFIG);

    expect(output).toBe("first version");
  });

  test("reads file contents at a ref relative to a subdirectory workspace", async () => {
    const dirPath = await createTempRepo("acolyte-gitshow-subdir-");
    await mkdir(join(dirPath, "src"));
    await writeFile(join(dirPath, "src", "tracked.txt"), "nested version\n", "utf8");
    await runGit(dirPath, ["add", "src/tracked.txt"]);
    await runGit(dirPath, ["commit", "-m", "add nested"]);

    const output = await gitShow(join(dirPath, "src"), { ref: "HEAD", path: "tracked.txt" }, ISOLATED_GIT_CONFIG);

    expect(output).toBe("nested version");
  });

  test("reads file contents at a ref after the file was deleted from the working tree", async () => {
    const dirPath = await createTempRepo("acolyte-gitshow-deleted-");
    await writeFile(join(dirPath, "gone.txt"), "old wording\n", "utf8");
    await runGit(dirPath, ["add", "gone.txt"]);
    await runGit(dirPath, ["commit", "-m", "add gone"]);
    await runGit(dirPath, ["rm", "gone.txt"]);
    await runGit(dirPath, ["commit", "-m", "remove gone"]);

    const output = await gitShow(dirPath, { ref: "HEAD~1", path: "gone.txt" }, ISOLATED_GIT_CONFIG);

    expect(output).toBe("old wording");
  });
});
