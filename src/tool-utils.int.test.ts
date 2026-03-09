import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitLog, gitShow } from "./git-ops";
import { runShellCommand } from "./shell-ops";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map(async (d) => rm(d, { recursive: true, force: true })));
});

describe("gitLog", () => {
  test("returns compact decorated commit history", async () => {
    const dirPath = `/tmp/acolyte-gitlog-${crypto.randomUUID()}`;
    tempDirs.push(dirPath);
    await mkdir(dirPath, { recursive: true });
    await runShellCommand(dirPath, "git init -b main");
    await runShellCommand(dirPath, "git config user.email test@example.com");
    await runShellCommand(dirPath, "git config user.name Test");
    await writeFile(join(dirPath, "a.txt"), "a\n", "utf8");
    await runShellCommand(dirPath, "git add a.txt");
    await runShellCommand(dirPath, "git commit -m first");
    await writeFile(join(dirPath, "b.txt"), "b\n", "utf8");
    await runShellCommand(dirPath, "git add b.txt");
    await runShellCommand(dirPath, "git commit -m second");
    const log = await gitLog(dirPath, { limit: 2 });
    const lines = log.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("second");
    expect(lines[1]).toContain("first");
  });
});

describe("gitShow", () => {
  test("returns commit patch for provided ref", async () => {
    const dirPath = `/tmp/acolyte-gitshow-${crypto.randomUUID()}`;
    tempDirs.push(dirPath);
    await mkdir(dirPath, { recursive: true });
    await runShellCommand(dirPath, "git init -b main");
    await runShellCommand(dirPath, "git config user.email test@example.com");
    await runShellCommand(dirPath, "git config user.name Test");
    await writeFile(join(dirPath, "a.txt"), "a\n", "utf8");
    await runShellCommand(dirPath, "git add a.txt");
    await runShellCommand(dirPath, "git commit -m first");
    await writeFile(join(dirPath, "a.txt"), "a changed\n", "utf8");
    await runShellCommand(dirPath, "git add a.txt");
    await runShellCommand(dirPath, "git commit -m second");
    const output = await gitShow(dirPath, { ref: "HEAD", contextLines: 0 });
    expect(output).toContain("second");
    expect(output).toContain("diff --git a/a.txt b/a.txt");
    expect(output).toContain("+a changed");
  });
});
