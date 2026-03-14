import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitLog, gitShow } from "./git-ops";
import { testUuid } from "./test-utils";

const tempDirs: string[] = [];
const GIT_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
] as const;

afterAll(async () => {
  await Promise.all(tempDirs.map(async (d) => rm(d, { recursive: true, force: true })));
});

async function runGit(dirPath: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`);
  return stdout.trim();
}

async function createTempRepo(prefix: string): Promise<string> {
  const dirPath = `/tmp/${prefix}-${testUuid()}`;
  tempDirs.push(dirPath);
  await mkdir(dirPath, { recursive: true });
  await runGit(dirPath, ["init", "-b", "main"]);
  await runGit(dirPath, ["config", "user.email", "test@example.com"]);
  await runGit(dirPath, ["config", "user.name", "Test"]);
  const topLevel = await runGit(dirPath, ["rev-parse", "--show-toplevel"]);
  expect(await realpath(topLevel)).toBe(await realpath(dirPath));
  return dirPath;
}

describe("gitLog", () => {
  test("returns compact decorated commit history", async () => {
    const dirPath = await createTempRepo("acolyte-gitlog");
    await writeFile(join(dirPath, "a.txt"), "a\n", "utf8");
    await runGit(dirPath, ["add", "a.txt"]);
    await runGit(dirPath, ["commit", "-m", "first"]);
    await writeFile(join(dirPath, "b.txt"), "b\n", "utf8");
    await runGit(dirPath, ["add", "b.txt"]);
    await runGit(dirPath, ["commit", "-m", "second"]);
    const log = await gitLog(dirPath, { limit: 2 });
    const lines = log.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("second");
    expect(lines[1]).toContain("first");
  });
});

describe("gitShow", () => {
  test("returns commit patch for provided ref", async () => {
    const dirPath = await createTempRepo("acolyte-gitshow");
    await writeFile(join(dirPath, "a.txt"), "a\n", "utf8");
    await runGit(dirPath, ["add", "a.txt"]);
    await runGit(dirPath, ["commit", "-m", "first"]);
    await writeFile(join(dirPath, "a.txt"), "a changed\n", "utf8");
    await runGit(dirPath, ["add", "a.txt"]);
    await runGit(dirPath, ["commit", "-m", "second"]);
    const output = await gitShow(dirPath, { ref: "HEAD", contextLines: 0 });
    expect(output).toContain("second");
    expect(output).toContain("diff --git a/a.txt b/a.txt");
    expect(output).toContain("+a changed");
  });
});
