import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitLog, gitShow } from "./git-ops";
import { tempDir, testUuid } from "./test-utils";
import { collectWorkspaceFiles, runCommand } from "./tool-utils";

const tempDirs: string[] = [];
const dirs = tempDir();

afterAll(async () => {
  dirs.cleanupDirs();
  await Promise.all(tempDirs.map(async (d) => rm(d, { recursive: true, force: true })));
});

async function runGit(dirPath: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", ...args], dirPath);
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

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const root = dirs.createDir("acolyte-tool-utils-");
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    await mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

describe("collectWorkspaceFiles — gitignore integration", () => {
  test("respects .gitignore patterns", async () => {
    const root = await createWorkspace({
      ".gitignore": "dist/\n*.log\n",
      "src/index.ts": "",
      "dist/bundle.js": "",
      "error.log": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/index.ts");
    expect(files).not.toContain("dist/bundle.js");
    expect(files).not.toContain("error.log");
    expect(files).toContain(".gitignore");
  });

  test("respects nested .gitignore files", async () => {
    const root = await createWorkspace({
      "src/.gitignore": "*.generated.ts\n",
      "src/foo.ts": "",
      "src/foo.generated.ts": "",
      "lib/foo.generated.ts": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/foo.ts");
    expect(files).not.toContain("src/foo.generated.ts");
    expect(files).toContain("lib/foo.generated.ts");
  });

  test("traverses hidden directories not in IGNORED_DIRS", async () => {
    const root = await createWorkspace({
      ".github/workflows/ci.yml": "",
      "src/index.ts": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain(".github/workflows/ci.yml");
    expect(files).toContain("src/index.ts");
  });

  test("always excludes .git and node_modules regardless of .gitignore", async () => {
    const root = await createWorkspace({
      "src/index.ts": "",
      "node_modules/pkg/index.js": "",
      ".git/config": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/index.ts");
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
  });
});
